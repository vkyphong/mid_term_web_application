package dev.pulsechat.lab;

import java.util.*;
import java.util.concurrent.*;
import java.time.Instant;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.socket.*;
import org.springframework.web.socket.handler.TextWebSocketHandler;
import org.springframework.web.socket.config.annotation.*;
import org.springframework.scheduling.concurrent.ThreadPoolTaskScheduler;
import dev.pulsechat.auth.*;
import dev.pulsechat.config.AppProperties;
import dev.pulsechat.common.*;

@Configuration
@EnableWebSocket
public class LabWebSocketConfig implements WebSocketConfigurer {
    private final AuthService auth;private final LabService lab;private final ObjectMapper mapper;private final AppProperties properties;private final ThreadPoolTaskScheduler scheduler;
    private final Handler handler=new Handler();
    public LabWebSocketConfig(AuthService auth,LabService lab,ObjectMapper mapper,AppProperties properties,ThreadPoolTaskScheduler realtimeScheduler){this.auth=auth;this.lab=lab;this.mapper=mapper;this.properties=properties;this.scheduler=realtimeScheduler;}
    @Override public void registerWebSocketHandlers(WebSocketHandlerRegistry registry){
        registry.addHandler(handler,"/lab/ws").setAllowedOrigins(properties.allowedOrigins().toArray(String[]::new));
    }
    @org.springframework.context.event.EventListener public void kicked(dev.pulsechat.realtime.ConnectionRegistry.UserKicked event){handler.users.forEach((id,user)->{if(user.userId().equals(event.userId())){var socket=handler.sockets.get(id);if(socket!=null)handler.close(socket);}});}
    private class Handler extends TextWebSocketHandler {
        final Map<String,WebSocketSession> sockets=new ConcurrentHashMap<>();
        final Map<String,SessionPrincipal> users=new ConcurrentHashMap<>();final Map<String,ScheduledFuture<?>> deadlines=new ConcurrentHashMap<>();
        @Override public void afterConnectionEstablished(WebSocketSession socket){sockets.put(socket.getId(),socket);socket.setTextMessageSizeLimit(4096);deadlines.put(socket.getId(),scheduler.schedule(()->close(socket),Instant.now().plusSeconds(5)));}
        @Override protected void handleTextMessage(WebSocketSession socket,TextMessage message)throws Exception{
            try{
                var frame=mapper.readTree(message.getPayload());var user=users.get(socket.getId());
                if(user==null){
                    if(!"lab:auth".equals(frame.path("type").asText()))throw new ApiException(401,"unauthorized",null,"Send lab:auth first");
                    user=auth.authenticate(frame.path("payload").path("authorization").asText());
                    synchronized(users){final String id=user.userId();if(users.values().stream().filter(p->p.userId().equals(id)).count()>=2)throw new ApiException(429,"rate_limited",null,"Maximum two Lab sockets per user");users.put(socket.getId(),user);}
                    var deadline=deadlines.remove(socket.getId());if(deadline!=null)deadline.cancel(false);
                    deadlines.put(socket.getId(),scheduler.scheduleAtFixedRate(()->{try{auth.validate(users.get(socket.getId()));}catch(Exception e){close(socket);}},java.time.Duration.ofSeconds(1)));
                    socket.sendMessage(new TextMessage(mapper.writeValueAsString(Map.of("type","lab:ready","payload",Map.of(),"ts",Instant.now().toString()))));
                }else socket.sendMessage(new TextMessage(mapper.writeValueAsString(lab.ping(user,frame))));
            }catch(Exception e){
                var error=e instanceof ApiException a?a:new ApiException(400,"invalid_payload","validation","Invalid Lab frame");
                socket.sendMessage(new TextMessage(mapper.writeValueAsString(Map.of("type","lab:error","payload",ApiErrors.body(error),"ts",Instant.now().toString()))));
                if(error.status==401||error.status==403||!users.containsKey(socket.getId()))close(socket);
            }
        }
        private void close(WebSocketSession socket){try{socket.close(CloseStatus.POLICY_VIOLATION);}catch(Exception ignored){}finally{cleanup(socket);}}
        private void cleanup(WebSocketSession socket){sockets.remove(socket.getId());users.remove(socket.getId());var deadline=deadlines.remove(socket.getId());if(deadline!=null)deadline.cancel(false);}
        @Override public void afterConnectionClosed(WebSocketSession socket,CloseStatus status){cleanup(socket);}
    }
}
