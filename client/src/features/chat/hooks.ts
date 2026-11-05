import { uuid } from '../../lib/uuid'
import { useCallback, useEffect } from 'react'
import { useInfiniteQuery, useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { useSession } from '../auth/hooks'
import { sessionQueryKey } from '../auth/session'
import type { Session } from '../auth/types'
import { chatApi, chatTransport } from './chatApi'
import { compareTimestamps, mergeMessages, reconcileLatestPage, setPendingStatus, upsertMessage } from './messages'
import { applyPresence } from './presence'
import { markDelivered, resetReceipts } from './receipts'
import { applyTyping, resetTyping } from './typing'
import { describeChatError } from './errors'
import {
  applyNotification,
  applyNotificationRead,
  describeNotification,
  isViewingRoom,
  pushToast,
  resetToasts,
} from './notifications'
import { enqueue, pump, resetOutbox, setOutboxSink, type OutboxItem } from './outbox'
import { playMessageSound, unlockSound } from './sound'
import { bumpUnread, markViewed, resetUnread, withViewed } from './unread'
import { resetUserAvatars, setUserAvatar, setUserAvatars } from './avatars'
import type { MediaKind, ChatMessage, ClientEvents, CreatePollInput, ProfileInput, CreateRoomInput, MemberRole, Message, Room, RoomMember, Upload } from './types'

export const chatKeys = {
  all: ['chat'] as const,
  rooms: ['chat', 'rooms'] as const,
  messages: (roomId: string) => ['chat', 'messages', roomId] as const,
  cursor: (roomId: string) => ['chat', 'cursor', roomId] as const,
  members: (roomId: string) => ['chat', 'members', roomId] as const,
  users: (search: string) => ['chat', 'users', search] as const,
}

function updateRooms(queryClient: QueryClient, update: (rooms: Room[]) => Room[]) {
  queryClient.setQueryData<Room[]>(chatKeys.rooms, (rooms) => (rooms ? update(rooms) : rooms))
}

function upsertRoom(queryClient: QueryClient, room: Room) {
  updateRooms(queryClient, (rooms) =>
    rooms.some((r) => r.id === room.id) ? rooms.map((r) => (r.id === room.id ? room : r)) : [...rooms, room],
  )
}

/** Ghi tin vào cache của phòng (nếu đã tải) và cập nhật lastMessageAt. */
function applyMessage(queryClient: QueryClient, message: ChatMessage) {
  queryClient.setQueryData<ChatMessage[]>(chatKeys.messages(message.roomId), (list) =>
    list ? upsertMessage(list, message) : list,
  )
  if (!message.status) {
    updateRooms(queryClient, (rooms) =>
      rooms.map((r) =>
        r.id === message.roomId && (!r.lastMessageAt || compareTimestamps(r.lastMessageAt, message.createdAt) < 0)
          ? { ...r, lastMessageAt: message.createdAt }
          : r,
      ),
    )
  }
}

export function useRooms() {
  return useQuery({
    queryKey: chatKeys.rooms,
    queryFn: async () => withViewed(await chatApi.listRooms()),
    staleTime: 30_000,
    // Số thành viên / phòng mới do người khác tạo không có event riêng → làm mới khi quay lại tab.
    refetchOnWindowFocus: true,
  })
}

/** Thêm lần lượt từng người (API nhận một userId mỗi lần); trả về phòng mới nhất và những người thêm lỗi. */
async function addMembers(roomId: string, userIds: readonly string[]) {
  let room: Room | null = null
  let pending = 0
  const failed: { userId: string; error: unknown }[] = []
  for (const userId of userIds) {
    try {
      const result = await chatApi.addMember(roomId, userId)
      if ('pending' in result) {
        pending++
        room = result.room
      } else room = result
    } catch (error) {
      failed.push({ userId, error })
    }
  }
  return { room, failed, pending }
}

export interface CreateGroupInput extends CreateRoomInput {
  memberIds?: string[]
}

/** Tạo kênh rồi thêm thành viên đã chọn (giống tạo nhóm Zalo). Lỗi thêm người không huỷ kênh đã tạo. */
export function useCreateRoom() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ memberIds = [], ...input }: CreateGroupInput) => {
      const created = await chatApi.createRoom(input)
      const { room, failed } = await addMembers(created.id, memberIds)
      return { room: room ?? created, failed }
    },
    onSuccess: ({ room, failed }) => {
      upsertRoom(queryClient, room)
      if (failed.length) {
        pushToast({
          id: `add-${room.id}`,
          title: `Chưa thêm được ${failed.length} người vào #${room.name}`,
          body: describeChatError(failed[0].error),
          tone: 'error',
        })
      }
    },
  })
}

/** Đổi tên nhóm / biệt danh / ảnh nhóm: kết quả là Room mới, ghi thẳng vào cache. */
function useRoomUpdate<T>(run: (input: T) => Promise<Room>) {
  const queryClient = useQueryClient()
  return useMutation({ mutationFn: run, onSuccess: (room) => upsertRoom(queryClient, withViewed([room])[0]) })
}

export const useRenameRoom = (roomId: string) => useRoomUpdate((name: string) => chatApi.renameRoom(roomId, name))
export const useSetNickname = (roomId: string) => useRoomUpdate((nickname: string) => chatApi.setNickname(roomId, nickname))
export const useUploadRoomAvatar = (roomId: string) => useRoomUpdate((file: File) => chatApi.uploadRoomAvatar(roomId, file))
export const useRemoveRoomAvatar = (roomId: string) => useRoomUpdate(() => chatApi.removeRoomAvatar(roomId))

/** Thêm người vào kênh đang mở; thành công một phần vẫn cập nhật số thành viên. */
export function useAddMembers(roomId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (userIds: string[]) => {
      const result = await addMembers(roomId, userIds)
      if (result.room) upsertRoom(queryClient, result.room)
      if (result.failed.length === userIds.length) throw result.failed[0].error
      return result
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: chatKeys.members(roomId) }),
  })
}

export function useJoinRoom() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (roomId: string) => chatTransport.request('room:join', { roomId }),
    onSuccess: (room) => {
      upsertRoom(queryClient, room)
      void queryClient.invalidateQueries({ queryKey: chatKeys.messages(room.id) })
    },
  })
}

export function useLeaveRoom() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (roomId: string) => chatTransport.request('room:leave', { roomId }),
    onSuccess: ({ roomId }) => {
      updateRooms(queryClient, (rooms) =>
        rooms.map((r) =>
          r.id === roomId ? { ...r, joined: false, memberCount: Math.max(0, r.memberCount - 1) } : r,
        ),
      )
      queryClient.removeQueries({ queryKey: chatKeys.messages(roomId) })
      queryClient.removeQueries({ queryKey: chatKeys.cursor(roomId) })
    },
  })
}

export function useMessages(roomId: string, enabled: boolean) {
  const queryClient = useQueryClient()
  return useQuery<ChatMessage[]>({
    queryKey: chatKeys.messages(roomId),
    queryFn: async () => {
      const page = await chatApi.listMessages(roomId)
      // Giữ tin tạm, tin realtime đến trong lúc tải và tin cũ đã tải thêm (nếu còn nối liền).
      const current = queryClient.getQueryData<ChatMessage[]>(chatKeys.messages(roomId)) ?? []
      const { messages, resetCursor } = reconcileLatestPage(current, page)
      if (resetCursor) queryClient.setQueryData<string | null>(chatKeys.cursor(roomId), page.nextCursor)
      return messages
    },
    enabled,
    // Tin mới đến qua realtime; chỉ tải lại khi reconnect (useChatEvents).
    staleTime: Infinity,
  })
}

/** Cursor để tải trang cũ hơn; null = đã hết lịch sử. Chỉ ghi qua setQueryData. */
function useHistoryCursor(roomId: string) {
  return useQuery<string | null>({
    queryKey: chatKeys.cursor(roomId),
    queryFn: () => null,
    enabled: false,
    staleTime: Infinity,
  }).data
}

/** F05: tải trang tin cũ hơn và gộp vào cache theo ID. */
export function useLoadOlder(roomId: string) {
  const queryClient = useQueryClient()
  const cursor = useHistoryCursor(roomId)
  const mutation = useMutation({
    mutationFn: (before: string) => chatApi.listMessages(roomId, before),
    onSuccess: (page, before) => {
      // Cursor đã đổi (vd trang mới nhất được đặt lại sau reconnect) → bỏ kết quả cũ.
      if (queryClient.getQueryData(chatKeys.cursor(roomId)) !== before) return
      queryClient.setQueryData<ChatMessage[]>(chatKeys.messages(roomId), (list) =>
        list ? mergeMessages(list, page.messages) : list,
      )
      queryClient.setQueryData<string | null>(chatKeys.cursor(roomId), page.nextCursor)
    },
  })

  const { mutate, isPending } = mutation
  const loadOlder = useCallback(() => {
    if (cursor && !isPending) mutate(cursor)
  }, [cursor, isPending, mutate])

  return { loadOlder, hasMore: Boolean(cursor), isLoading: isPending, error: mutation.error }
}

/** Trích tin để hiện ngay trong bản tạm khi trả lời. */
export function toReplyRef(m: ChatMessage) {
  return {
    id: m.id,
    sender: m.sender,
    content: m.content.length > 120 ? `${m.content.slice(0, 117)}…` : m.content,
    attachmentName: m.attachment?.filename ?? null,
    deleted: Boolean(m.deletedAt),
  }
}

/** Payload gốc của tin đang chờ, để gửi lại đúng clientMsgId + nội dung + mentions + uploadId (F10). */
const outboxPayloads = new Map<string, OutboxItem>()

export interface SendOptions {
  mentions?: string[]
  /** F15: file đã upload xong; hiển thị ngay trong bản tạm. */
  upload?: Upload
  /** Trả lời tin này. */
  replyTo?: ChatMessage
}

/** Gửi tin: hiện ngay bản tạm rồi đưa vào hàng đợi (F10); thay bằng tin thật khi có ack hoặc message:new. */
export function useSendMessage(roomId: string) {
  const queryClient = useQueryClient()
  const { user } = useSession()

  const send = useCallback(
    (content: string, options: SendOptions = {}) => {
      if (!user) return
      const clientMsgId = uuid()
      const { upload } = options
      const item: OutboxItem = {
        roomId,
        content,
        clientMsgId,
        ...(options.mentions?.length ? { mentions: options.mentions } : {}),
        ...(upload ? { uploadId: upload.id } : {}),
        ...(options.replyTo ? { replyToId: options.replyTo.id } : {}),
      }
      outboxPayloads.set(clientMsgId, item)
      applyMessage(queryClient, {
        id: `pending:${clientMsgId}`,
        roomId,
        clientMsgId,
        sender: { id: user.id, displayName: user.displayName },
        content,
        createdAt: new Date().toISOString(),
        status: 'sending',
        attachment: upload
          ? { id: upload.id, filename: upload.filename, mediaType: upload.mediaType, size: upload.size, url: upload.url }
          : null,
        replyTo: options.replyTo ? toReplyRef(options.replyTo) : null,
      })
      enqueue(item)
    },
    [queryClient, roomId, user],
  )

  /** Gửi lại tin lỗi với cùng clientMsgId và payload để BE không tạo trùng. */
  const retry = useCallback(
    (message: ChatMessage) => {
      if (!message.clientMsgId) return
      const item = outboxPayloads.get(message.clientMsgId) ?? { roomId, content: message.content, clientMsgId: message.clientMsgId }
      queryClient.setQueryData<ChatMessage[]>(chatKeys.messages(roomId), (list) =>
        list ? setPendingStatus(list, message.clientMsgId!, 'sending') : list,
      )
      enqueue(item)
    },
    [queryClient, roomId],
  )

  return { send, retry }
}

/** F14: sửa / xoá / thả cảm xúc. Kết quả (ack hoặc event) thay tin theo ID, không tạo tin mới. */
export function useMessageActions() {
  const queryClient = useQueryClient()
  const run = useCallback(
    async <T extends 'message:edit' | 'message:delete' | 'message:react'>(type: T, payload: ClientEvents[T]['payload']) => {
      try {
        applyMessage(queryClient, await chatTransport.request(type, payload))
        return true
      } catch (err) {
        pushToast({ id: `action-${uuid()}`, title: 'Không thực hiện được', body: describeChatError(err), tone: 'error' })
        return false
      }
    },
    [queryClient],
  )
  /** Thao tác qua REST (ghim, ẩn phía mình): lỗi thì báo toast. */
  const rest = useCallback(async (fn: () => Promise<void>) => {
    try {
      await fn()
      return true
    } catch (err) {
      pushToast({ id: `action-${uuid()}`, title: 'Không thực hiện được', body: describeChatError(err), tone: 'error' })
      return false
    }
  }, [])
  return {
    edit: (messageId: string, content: string) => run('message:edit', { messageId, content }),
    remove: (messageId: string) => run('message:delete', { messageId }),
    react: (messageId: string, emoji: string, active: boolean) => run('message:react', { messageId, emoji, active }),
    pin: (messageId: string, pinned: boolean) =>
      rest(async () => {
        const message = await chatApi.pinMessage(messageId, pinned)
        applyMessage(queryClient, message)
        void queryClient.invalidateQueries({ queryKey: pinsKey(message.roomId) })
      }),
    hide: (messageId: string) =>
      rest(async () => {
        const { id, roomId } = await chatApi.hideMessage(messageId)
        queryClient.setQueryData<ChatMessage[]>(chatKeys.messages(roomId), (list) => list?.filter((m) => m.id !== id))
        void queryClient.invalidateQueries({ queryKey: pinsKey(roomId) })
      }),
  }
}

/** F09: thành viên phòng để chọn @mention. */
/** Trưởng nhóm bổ nhiệm / bỏ phó nhóm. */
export function useSetMemberRole(roomId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ userId, role }: { userId: string; role: Exclude<MemberRole, 'owner'> }) => chatApi.setMemberRole(roomId, userId, role),
    onSuccess: (members) => queryClient.setQueryData<RoomMember[]>(chatKeys.members(roomId), members),
  })
}

/** Tạo bình chọn: tin bình chọn hiện ngay (ack REST), người khác nhận qua message:new. */
export function useCreatePoll(roomId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: CreatePollInput) => chatApi.createPoll(roomId, input),
    onSuccess: (message) => applyMessage(queryClient, message),
  })
}

/** Khoá (closed=true) hoặc mở lại bình chọn. */
export const pinsKey = (roomId: string) => ['chat', 'pins', roomId] as const

/** Tin đang ghim của phòng (thanh ghim đầu đoạn chat). */
export function usePins(roomId: string) {
  return useQuery({ queryKey: pinsKey(roomId), queryFn: () => chatApi.listPins(roomId), staleTime: 30_000 })
}

export function usePinMessage() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ messageId, pinned }: { messageId: string; pinned: boolean }) => chatApi.pinMessage(messageId, pinned),
    onSuccess: (message) => {
      applyMessage(queryClient, message)
      void queryClient.invalidateQueries({ queryKey: pinsKey(message.roomId) })
    },
  })
}

/** "Xoá chỉ ở phía tôi": bỏ tin khỏi màn hình của mình ngay. */
export function useHideMessage() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (messageId: string) => chatApi.hideMessage(messageId),
    onSuccess: ({ id, roomId }) => {
      queryClient.setQueryData<ChatMessage[]>(chatKeys.messages(roomId), (list) => list?.filter((m) => m.id !== id))
      void queryClient.invalidateQueries({ queryKey: pinsKey(roomId) })
    },
  })
}

export function useForwardMessage() {
  return useMutation({
    mutationFn: ({ messageId, roomIds, note }: { messageId: string; roomIds: string[]; note?: string }) =>
      chatApi.forwardMessage(messageId, roomIds, note),
  })
}

export function useClosePoll() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ pollId, closed }: { pollId: string; closed: boolean }) =>
      closed ? chatApi.closePoll(pollId) : chatApi.reopenPoll(pollId),
    onSuccess: (message) => applyMessage(queryClient, message),
  })
}

export function useVote() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ pollId, optionIds }: { pollId: string; optionIds: string[] }) => chatApi.vote(pollId, optionIds),
    onSuccess: (message) => applyMessage(queryClient, message),
  })
}

/** Ảnh / file / link của phòng, 20 mục mỗi trang, mới nhất trước. */
export function useRoomMedia(roomId: string, kind: MediaKind) {
  return useInfiniteQuery({
    queryKey: ['chat', 'media', roomId, kind] as const,
    queryFn: ({ pageParam }) => chatApi.listRoomMedia(roomId, kind, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    staleTime: 0,
  })
}

/** Tìm tin trong phòng: 20 kết quả mỗi trang, mới nhất trước. */
export function useMessageSearch(roomId: string, query: string) {
  return useInfiniteQuery({
    queryKey: ['chat', 'search', roomId, query] as const,
    queryFn: ({ pageParam }) => chatApi.searchMessages(roomId, query, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    enabled: query.length > 0,
    staleTime: 10_000,
  })
}

/** Tải dần lịch sử tới khi tin có trong cache; false nếu không tìm thấy. */
export function useJumpToMessage(roomId: string) {
  const queryClient = useQueryClient()
  return useCallback(
    async (messageId: string) => {
      for (let page = 0; page < 100; page++) {
        const list = queryClient.getQueryData<ChatMessage[]>(chatKeys.messages(roomId)) ?? []
        if (list.some((m) => m.id === messageId)) return true
        const cursor = queryClient.getQueryData<string | null>(chatKeys.cursor(roomId))
        if (!cursor) return false
        const older = await chatApi.listMessages(roomId, cursor)
        queryClient.setQueryData<ChatMessage[]>(chatKeys.messages(roomId), (current) =>
          current ? mergeMessages(current, older.messages) : current,
        )
        queryClient.setQueryData<string | null>(chatKeys.cursor(roomId), older.nextCursor)
      }
      return false
    },
    [queryClient, roomId],
  )
}

export function useUploadMyAvatar() {
  return useMutation({ mutationFn: (file: File) => chatApi.uploadMyAvatar(file), onSuccess: setUserAvatar })
}

export const profileKey = ['chat', 'profile'] as const

export function useMyProfile() {
  return useQuery({ queryKey: profileKey, queryFn: () => chatApi.getMyProfile(), staleTime: 60_000 })
}

/** Lưu thông tin tài khoản; tên mới cập nhật luôn vào phiên đăng nhập (đầu trang, tin mình gửi). */
export function useUpdateProfile() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: ProfileInput) => chatApi.updateMyProfile(input),
    onSuccess: (profile) => {
      queryClient.setQueryData(profileKey, profile)
      queryClient.setQueryData<Session | null>(sessionQueryKey, (session) =>
        session ? { ...session, user: { ...session.user, displayName: profile.displayName } } : session,
      )
    },
  })
}

export function useRemoveMyAvatar() {
  return useMutation({ mutationFn: () => chatApi.removeMyAvatar(), onSuccess: setUserAvatar })
}

export const requestsKey = (roomId: string) => ['chat', 'requests', roomId] as const

/** Trưởng nhóm bật / tắt "Phê duyệt thành viên mới". */
export function useRoomSettings(roomId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (requireApproval: boolean) => chatApi.updateRoomSettings(roomId, { requireApproval }),
    onSuccess: (room) => upsertRoom(queryClient, withViewed([room])[0]),
  })
}

/** Yêu cầu chờ duyệt (chỉ tải khi mình là trưởng / phó nhóm); tải lại khi số chờ duyệt đổi. */
export function useMemberRequests(roomId: string, enabled: boolean, pending: number) {
  return useQuery({
    queryKey: [...requestsKey(roomId), pending],
    queryFn: () => chatApi.listMemberRequests(roomId),
    enabled,
  })
}

export function useDecideMemberRequest(roomId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ requestId, approve }: { requestId: string; approve: boolean }) => chatApi.decideMemberRequest(roomId, requestId, approve),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: requestsKey(roomId) })
      void queryClient.invalidateQueries({ queryKey: chatKeys.members(roomId) })
      void queryClient.invalidateQueries({ queryKey: chatKeys.rooms })
    },
  })
}

export function useRoomMembers(roomId: string) {
  return useQuery({
    queryKey: chatKeys.members(roomId),
    queryFn: () => chatApi.listMembers(roomId),
    staleTime: 60_000,
  })
}

export function useUserSearch(search: string, enabled = true) {
  return useQuery({
    queryKey: chatKeys.users(search),
    queryFn: () => chatApi.searchUsers(search),
    enabled,
    staleTime: 30_000,
  })
}

export function useOpenDm() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (userId: string) => chatApi.openDm(userId),
    onSuccess: (room) => upsertRoom(queryClient, room),
  })
}

/** Nối event realtime và hàng đợi gửi tin vào cache. Mount một lần trong layout chat. */
export function useChatEvents() {
  const queryClient = useQueryClient()
  const { user } = useSession()
  const selfId = user?.id

  useEffect(() => {
    setOutboxSink({
      sent: (message) => {
        if (message.clientMsgId) outboxPayloads.delete(message.clientMsgId)
        applyMessage(queryClient, message)
      },
      state: (item, state, error) =>
        queryClient.setQueryData<ChatMessage[]>(chatKeys.messages(item.roomId), (list) =>
          list ? setPendingStatus(list, item.clientMsgId, state, error) : list,
        ),
    })

    // Trình duyệt chỉ cho phát âm thanh sau tương tác đầu tiên của người dùng.
    window.addEventListener('pointerdown', unlockSound)
    window.addEventListener('keydown', unlockSound)

    const offEvent = chatTransport.onEvent((event) => {
      switch (event.type) {
        case 'whiteboard:segment':
        case 'whiteboard:cleared':
          return // The mounted whiteboard consumes its own private events.
        case 'presence:update':
          return applyPresence(queryClient, event.payload)
        case 'typing:start':
        case 'typing:stop':
          if (event.payload.userId !== selfId) applyTyping(event.payload)
          return
        case 'notification:new': {
          const n = event.payload
          // Tin nhắn riêng hiện bằng số đỏ cạnh tên + âm báo, không đưa vào chuông.
          if (n.type === 'dm') return
          if (applyNotification(queryClient, n) && !n.readAt && !isViewingRoom(n.roomId)) {
            pushToast({ id: n.id, notificationId: n.id, title: describeNotification(n), body: n.content, roomId: n.roomId })
          }
          return
        }
        case 'notification:read':
          return applyNotificationRead(queryClient, event.payload.id)
        case 'room:updated':
          upsertRoom(queryClient, withViewed([event.payload])[0])
          // Vai trò thành viên (trưởng / phó nhóm) có thể vừa đổi.
          void queryClient.invalidateQueries({ queryKey: chatKeys.members(event.payload.id) })
          return
        case 'user:avatar':
          return setUserAvatar(event.payload)
        case 'message:hidden':
          // "Xoá chỉ ở phía tôi" từ tab khác của mình.
          return queryClient.setQueryData<ChatMessage[]>(chatKeys.messages(event.payload.roomId), (list) =>
            list?.filter((m) => m.id !== event.payload.id),
          )
        case 'room:added': {
          const room = event.payload
          const known = queryClient.getQueryData<Room[]>(chatKeys.rooms)?.find((r) => r.id === room.id)
          upsertRoom(queryClient, room)
          void queryClient.invalidateQueries({ queryKey: chatKeys.members(room.id) })
          if (!known?.joined) {
            pushToast({ id: `added-${room.id}`, title: 'Bạn đã được thêm vào nhóm', body: `#${room.name}`, roomId: room.id })
          }
          return
        }
      }
      const message: Message = event.payload
      const known = queryClient.getQueryData<Room[]>(chatKeys.rooms)?.some((r) => r.id === message.roomId)
      // message:delivered/seen/edit/delete/react mang Message đã cập nhật -> thay theo ID, không thêm tin.
      applyMessage(queryClient, message)
      if (event.type === 'message:pin') void queryClient.invalidateQueries({ queryKey: pinsKey(message.roomId) })
      if (event.type === 'message:new') {
        if (selfId) markDelivered(message, selfId)
        // Đếm tin chưa đọc + âm báo cho tin của người khác ở phòng không đang xem.
        // Dòng hoạt động bình chọn là tin hệ thống: không tính chưa đọc, không kêu.
        if (message.sender.id !== selfId && !message.activity) {
          // Như Messenger: tin của người khác luôn có âm báo, kể cả khi đang mở đúng phòng đó.
          playMessageSound(message.id)
          if (isViewingRoom(message.roomId)) markViewed(queryClient, message.roomId, message.createdAt)
          else bumpUnread(queryClient, message)
        }
        // Tin đến thì người đó hết "đang gõ".
        applyTyping({ roomId: message.roomId, userId: message.sender.id, typing: false, ttlMs: 0 })
      }
      // Phòng chưa biết (vd ai đó vừa mở DM với mình) -> tải lại danh sách.
      if (!known) void queryClient.invalidateQueries({ queryKey: chatKeys.rooms })
    })
    // Kết nối lại: tải lại dữ liệu và avatar, rồi gửi bù hàng đợi (F10). Lỗi avatar thì hiện chữ cái.
    const loadAvatars = () =>
      Promise.resolve()
        .then(() => chatApi.listUserAvatars())
        .then(setUserAvatars)
        .catch(() => {})
    void loadAvatars()
    const offConnected = chatTransport.onConnected(() => {
      void loadAvatars()
      void queryClient.invalidateQueries({ queryKey: chatKeys.all })
      pump()
    })
    // Mạng có lại mà socket chưa từng bị đóng (mất mạng rất ngắn) → vẫn gửi bù.
    window.addEventListener('online', pump)
    pump()
    return () => {
      window.removeEventListener('online', pump)
      window.removeEventListener('pointerdown', unlockSound)
      window.removeEventListener('keydown', unlockSound)
      resetUnread()
      resetUserAvatars()
      offEvent()
      offConnected()
      setOutboxSink(null)
      resetOutbox()
      outboxPayloads.clear()
      resetTyping()
      resetReceipts()
      resetToasts()
    }
  }, [queryClient, selfId])
}
