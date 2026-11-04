package dev.pulsechat.chat;

import java.time.Instant;
import java.util.List;

public final class ChatDtos {
    private ChatDtos() {}
    public record UserSummary(String id, String displayName, String email) {}
    /**
     * memberRole: vai trò trong nhóm, owner (trưởng nhóm) / deputy (phó nhóm) / member; DM luôn là member.
     * Không đặt tên "role" để không lẫn với vai trò tài khoản (admin/user), vốn không được lộ ra.
     */
    public record RoomMember(String id, String displayName, String email, boolean enabled, String memberRole) {}
    public record AddMember(String userId) {}
    public record RenameRoom(String name) {}
    public record SetNickname(String nickname) {}
    public record SetRole(String role) {}
    public record Sender(String id, String displayName) {}
    @com.fasterxml.jackson.annotation.JsonInclude(com.fasterxml.jackson.annotation.JsonInclude.Include.ALWAYS)
    public record Room(String id, String type, String name, String description, int memberCount,
                       boolean joined, UserSummary peer, Instant lastMessageAt, boolean archived, int unreadCount,
                       String nickname, String avatarUrl, List<UserSummary> previewMembers, String myRole,
                       boolean requireApproval, int pendingRequests) {}
    public record RoomSettings(Boolean requireApproval) {}
    /** Một mục trong "Ảnh/Video", "File" hoặc "Link" của phòng: attachment (ảnh / file) hoặc url (link). */
    public record MediaItem(String messageId, Instant createdAt, Sender sender, Object attachment, String url) {}
    @com.fasterxml.jackson.annotation.JsonInclude(com.fasterxml.jackson.annotation.JsonInclude.Include.ALWAYS)
    public record MediaPage(List<MediaItem> items, String nextCursor) {}
    /** Kết quả thêm người khi nhóm cần phê duyệt: yêu cầu đã được gửi, chưa vào nhóm. */
    public record PendingAdd(boolean pending, MemberRequest request, Room room) {}
    public record MemberRequest(String id, UserSummary user, UserSummary requestedBy, Instant createdAt) {}
    public record Message(String id, String roomId, String clientMsgId, Sender sender, String content, Instant createdAt,
                          Instant editedAt, Instant deletedAt, Object attachment, Object receipts, Object reactions, Poll poll,
                          Activity activity, ReplyRef replyTo, Instant pinnedAt, String pinnedBy) {}
    /** Trích tin được trả lời: nội dung rút gọn, tên file (nếu có), đã thu hồi hay chưa. */
    public record ReplyRef(String id, Sender sender, String content, String attachmentName, boolean deleted) {}
    public record Forward(List<String> roomIds, String note) {}
    public record Pin(Boolean pinned) {}
    public record PollOption(String id, String label, List<String> voters) {}
    public record Poll(String id, String question, boolean multiple, String createdBy, List<PollOption> options,
                       Instant closedAt, String closedBy) {}
    /** Dòng hoạt động bình chọn: type vote / change / unvote / close; content của tin là câu hỏi. */
    public record Activity(String type, String pollId, String pollMessageId) {}
    public record CreatePoll(String question, List<String> options, Boolean multiple, String clientMsgId) {}
    public record Vote(List<String> optionIds) {}
    @com.fasterxml.jackson.annotation.JsonInclude(com.fasterxml.jackson.annotation.JsonInclude.Include.ALWAYS)
    public record MessagePage(List<Message> messages, String nextCursor) {}
    public record CreateRoom(String name, String description) {}
    public record OpenDm(String userId) {}
    public record Envelope(String type, Object payload, String ts) {
        public Envelope(String type, Object payload) { this(type, payload, Instant.now().toString()); }
    }
    public record Delivery(Message message, List<String> recipients, boolean created) {}
}
