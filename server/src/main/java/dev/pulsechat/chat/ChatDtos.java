package dev.pulsechat.chat;

import java.time.Instant;
import java.util.List;

public final class ChatDtos {
    private ChatDtos() {}
    public record UserSummary(String id, String displayName, String email) {}
    public record Sender(String id, String displayName) {}
    @com.fasterxml.jackson.annotation.JsonInclude(com.fasterxml.jackson.annotation.JsonInclude.Include.ALWAYS)
    public record Room(String id, String type, String name, String description, int memberCount,
                       boolean joined, UserSummary peer, Instant lastMessageAt) {}
    public record Message(String id, String roomId, String clientMsgId, Sender sender, String content, Instant createdAt,
                          Instant editedAt, Instant deletedAt, Object attachment, Object receipts, Object reactions) {}
    @com.fasterxml.jackson.annotation.JsonInclude(com.fasterxml.jackson.annotation.JsonInclude.Include.ALWAYS)
    public record MessagePage(List<Message> messages, String nextCursor) {}
    public record CreateRoom(String name, String description) {}
    public record OpenDm(String userId) {}
    public record Envelope(String type, Object payload, String ts) {
        public Envelope(String type, Object payload) { this(type, payload, Instant.now().toString()); }
    }
    public record Delivery(Message message, List<String> recipients, boolean created) {}
}
