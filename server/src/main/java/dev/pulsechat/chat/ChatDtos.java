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
                       String nickname, String avatarUrl, List<UserSummary> previewMembers, String myRole) {}
    public record Message(String id, String roomId, String clientMsgId, Sender sender, String content, Instant createdAt,
                          Instant editedAt, Instant deletedAt, Object attachment, Object receipts, Object reactions, Poll poll) {}
    public record PollOption(String id, String label, List<String> voters) {}
    public record Poll(String id, String question, boolean multiple, String createdBy, List<PollOption> options) {}
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
