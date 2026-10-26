package dev.pulsechat.chat;

import com.fasterxml.jackson.databind.*;
import java.util.*;
import org.springframework.stereotype.Controller;
import org.springframework.messaging.handler.annotation.MessageMapping;
import org.springframework.messaging.simp.*;
import dev.pulsechat.auth.SessionPrincipal;
import dev.pulsechat.common.*;
import dev.pulsechat.realtime.*;

@Controller
public class CollaborationSocketController {
    private final ChatService chat;private final MessageActions actions;private final SessionRateLimiter limits;
    private final RealtimeEvents events;private final SimpMessagingTemplate broker;private final ObjectMapper mapper;
    private final dev.pulsechat.admin.AdminService admin;
    public CollaborationSocketController(ChatService chat,MessageActions actions,SessionRateLimiter limits,RealtimeEvents events,SimpMessagingTemplate broker,ObjectMapper mapper,dev.pulsechat.admin.AdminService admin){this.chat=chat;this.actions=actions;this.limits=limits;this.events=events;this.broker=broker;this.mapper=mapper;this.admin=admin;}
    @MessageMapping({"/typing.start","/typing.stop","/message.delivered","/message.seen","/message.edit","/message.delete","/message.react","/admin.kick","/admin.broadcast"})
    public void handle(byte[] body,SessionPrincipal user,SimpMessageHeaderAccessor headers){
        String correlation="";
        try{
            JsonNode frame;try{frame=mapper.readTree(body);}catch(Exception e){throw ChatService.field("payload","Invalid JSON");}
            correlation=required(frame,"correlationId");
            String destination=headers.getDestination().substring("/app/".length());
            if(!required(frame,"type").equals(destination.replace('.',':')))throw ChatService.field("type","Type does not match destination");
            JsonNode payload=frame.path("payload");Object data;
            limits.check(headers.getSessionId(),"actions",30,5000);
            if(destination.equals("admin.kick")){
                String target=required(payload,"userId");admin.kick(user.userId(),target);data=Map.of("userId",target);
            }else if(destination.equals("admin.broadcast")){
                data=admin.broadcast(user.userId(),payload.path("content").asText(null));
            }else if(destination.startsWith("typing.")){
                String room=required(payload,"roomId");chat.requireMember(room,user.userId());
                limits.check(headers.getSessionId(),"typing",5,1000);
                data=Map.of("roomId",room,"userId",user.userId(),"typing",destination.endsWith("start"),"ttlMs",3000);
                events.send(chat.recipients(room),"/queue/typing",destination.replace('.',':'),data);
            }else{
                if(destination.endsWith("react")&&!payload.path("active").isBoolean())throw ChatService.field("active","Boolean required");
                data=actions.change(user.userId(),required(payload,"messageId"),destination.substring("message.".length()),payload.path("content").asText(null),payload.path("emoji").asText(""),payload.path("active").asBoolean());
            }
            ack(user,headers,Map.of("correlationId",correlation,"ok",true,"data",data));
        }catch(ApiException e){ack(user,headers,Map.of("correlationId",correlation,"ok",false,"error",ApiErrors.body(e).get("error")));}
    }
    private static String required(JsonNode node,String field){
        if(node==null||!node.path(field).isTextual()||node.path(field).asText().isBlank()||node.path(field).asText().length()>128)throw ChatService.field(field,"Nonempty string, maximum 128 characters required");return node.path(field).asText();
    }
    private void ack(SessionPrincipal user,SimpMessageHeaderAccessor incoming,Object payload){
        var headers=SimpMessageHeaderAccessor.create(SimpMessageType.MESSAGE);headers.setSessionId(incoming.getSessionId());headers.setLeaveMutable(true);
        broker.convertAndSendToUser(user.userId(),"/queue/acks",new ChatDtos.Envelope("ack",payload),headers.getMessageHeaders());
    }
}
