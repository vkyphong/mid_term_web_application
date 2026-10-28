import { uuid } from '../../lib/uuid'
import { useCallback, useEffect } from 'react'
import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { useSession } from '../auth/hooks'
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
import type { ChatMessage, ClientEvents, CreateRoomInput, Message, Room, Upload } from './types'

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
    queryFn: () => chatApi.listRooms(),
    staleTime: 30_000,
    // Số thành viên / phòng mới do người khác tạo không có event riêng → làm mới khi quay lại tab.
    refetchOnWindowFocus: true,
  })
}

export function useCreateRoom() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: CreateRoomInput) => chatApi.createRoom(input),
    onSuccess: (room) => upsertRoom(queryClient, room),
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

/** Payload gốc của tin đang chờ, để gửi lại đúng clientMsgId + nội dung + mentions + uploadId (F10). */
const outboxPayloads = new Map<string, OutboxItem>()

export interface SendOptions {
  mentions?: string[]
  /** F15: file đã upload xong; hiển thị ngay trong bản tạm. */
  upload?: Upload
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
  return {
    edit: (messageId: string, content: string) => run('message:edit', { messageId, content }),
    remove: (messageId: string) => run('message:delete', { messageId }),
    react: (messageId: string, emoji: string, active: boolean) => run('message:react', { messageId, emoji, active }),
  }
}

/** F09: thành viên phòng để chọn @mention. */
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
          if (applyNotification(queryClient, n) && !n.readAt && !isViewingRoom(n.roomId)) {
            pushToast({ id: n.id, notificationId: n.id, title: describeNotification(n), body: n.content, roomId: n.roomId })
          }
          return
        }
        case 'notification:read':
          return applyNotificationRead(queryClient, event.payload.id)
      }
      const message: Message = event.payload
      const known = queryClient.getQueryData<Room[]>(chatKeys.rooms)?.some((r) => r.id === message.roomId)
      // message:delivered/seen/edit/delete/react mang Message đã cập nhật -> thay theo ID, không thêm tin.
      applyMessage(queryClient, message)
      if (event.type === 'message:new') {
        if (selfId) markDelivered(message, selfId)
        // Tin đến thì người đó hết "đang gõ".
        applyTyping({ roomId: message.roomId, userId: message.sender.id, typing: false, ttlMs: 0 })
      }
      // Phòng chưa biết (vd ai đó vừa mở DM với mình) -> tải lại danh sách.
      if (!known) void queryClient.invalidateQueries({ queryKey: chatKeys.rooms })
    })
    // Có thể đã lỡ event khi mất kết nối -> tải lại; rồi gửi bù hàng đợi (F10).
    const offConnected = chatTransport.onConnected(() => {
      void queryClient.invalidateQueries({ queryKey: chatKeys.all })
      pump()
    })
    // Mạng có lại mà socket chưa từng bị đóng (mất mạng rất ngắn) → vẫn gửi bù.
    window.addEventListener('online', pump)
    pump()
    return () => {
      window.removeEventListener('online', pump)
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
