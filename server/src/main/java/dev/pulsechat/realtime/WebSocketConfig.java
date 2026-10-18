package dev.pulsechat.realtime;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.context.annotation.*;
import org.springframework.messaging.simp.config.*;
import org.springframework.scheduling.concurrent.ThreadPoolTaskScheduler;
import org.springframework.web.socket.*;
import org.springframework.web.socket.config.annotation.*;
import org.springframework.web.socket.handler.WebSocketHandlerDecorator;
import dev.pulsechat.config.AppProperties;

@Configuration
@EnableWebSocketMessageBroker
public class WebSocketConfig implements WebSocketMessageBrokerConfigurer {
    private final StompAuthInterceptor auth;
    private final ConnectionRegistry connections;
    private final AppProperties properties;
    private final ObjectMapper mapper;
    private final ThreadPoolTaskScheduler scheduler;
    public WebSocketConfig(StompAuthInterceptor auth, ConnectionRegistry connections, AppProperties properties, ObjectMapper mapper, ThreadPoolTaskScheduler realtimeScheduler) {
        this.auth = auth; this.connections = connections; this.properties = properties; this.mapper = mapper; this.scheduler = realtimeScheduler;
    }
    @Bean public static ThreadPoolTaskScheduler realtimeScheduler() {
        var scheduler = new ThreadPoolTaskScheduler(); scheduler.setPoolSize(2); scheduler.setThreadNamePrefix("realtime-");
        scheduler.setRemoveOnCancelPolicy(true); return scheduler;
    }
    @Override public void registerStompEndpoints(StompEndpointRegistry registry) {
        registry.setErrorHandler(new StompErrors(mapper));
        registry.addEndpoint("/ws").setAllowedOrigins(properties.allowedOrigins().toArray(String[]::new));
    }
    @Override public void configureClientInboundChannel(ChannelRegistration registration) {
        registration.interceptors(auth);
        // One instance: ordered application dispatch without deferring interceptor errors.
        registration.taskExecutor().corePoolSize(1).maxPoolSize(1);
    }
    @Override public void configureMessageBroker(MessageBrokerRegistry registry) {
        registry.setApplicationDestinationPrefixes("/app"); registry.setUserDestinationPrefix("/user");
        registry.enableSimpleBroker("/queue").setTaskScheduler(scheduler).setHeartbeatValue(new long[]{10000, 10000});
        registry.setPreservePublishOrder(true);
    }
    @Override public void configureWebSocketTransport(WebSocketTransportRegistration registration) {
        registration.setMessageSizeLimit(8192).setSendBufferSizeLimit(32768).setSendTimeLimit(10000).setTimeToFirstMessage(5000);
        registration.addDecoratorFactory(handler -> new WebSocketHandlerDecorator(handler) {
            @Override public void afterConnectionEstablished(WebSocketSession session) throws Exception {
                connections.opened(session); super.afterConnectionEstablished(session);
            }
            @Override public void afterConnectionClosed(WebSocketSession session, CloseStatus status) throws Exception {
                connections.removed(session.getId()); super.afterConnectionClosed(session, status);
            }
        });
    }
}
