package dev.pulsechat.realtime;

import dev.pulsechat.chat.ChatDtos.Envelope;
import java.util.Collection;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.messaging.simp.SimpMessagingTemplate;
import org.springframework.stereotype.Component;
import org.springframework.transaction.support.*;

@Component
public class RealtimeEvents {
    private final ObjectProvider<SimpMessagingTemplate> broker;
    public RealtimeEvents(ObjectProvider<SimpMessagingTemplate> broker) { this.broker = broker; }
    public void send(Collection<String> users, String queue, String type, Object payload) {
        Runnable send = () -> users.forEach(user -> broker.getObject().convertAndSendToUser(user, queue, new Envelope(type, payload)));
        if (TransactionSynchronizationManager.isSynchronizationActive()) {
            TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
                @Override public void afterCommit() { send.run(); }
            });
        } else send.run();
    }
}
