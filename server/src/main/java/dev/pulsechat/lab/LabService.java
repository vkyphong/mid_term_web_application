package dev.pulsechat.lab;

import java.util.*;
import java.util.concurrent.*;
import java.time.Instant;
import java.io.IOException;
import com.fasterxml.jackson.databind.JsonNode;
import org.springframework.stereotype.Service;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.web.servlet.mvc.method.annotation.*;
import org.springframework.web.context.request.async.DeferredResult;
import dev.pulsechat.auth.*;
import dev.pulsechat.chat.ChatService;
import dev.pulsechat.realtime.SessionRateLimiter;

@Service
public class LabService {
    private static class State {
        volatile SessionPrincipal user;long sequence;
        final ArrayDeque<Map<String,Object>> history=new ArrayDeque<>();
        final List<Waiting> waiting=new ArrayList<>();final List<SseEmitter> streams=new ArrayList<>();
        State(SessionPrincipal user){this.user=user;}
    }
    private record Waiting(long after,DeferredResult<Object> response){}
    private final Map<String,State> states=new ConcurrentHashMap<>();
    private final AuthService auth;private final SessionRateLimiter limits;
    public LabService(AuthService auth,SessionRateLimiter limits){this.auth=auth;this.limits=limits;}
    private State state(SessionPrincipal user){auth.validate(user);var state=states.computeIfAbsent(user.sessionId(),id->new State(user));if(user.expiresAt().isAfter(state.user.expiresAt()))state.user=user;return state;}
    public Object ping(SessionPrincipal user,JsonNode frame){
        if(frame==null||!"lab:ping".equals(frame.path("type").asText())||!frame.path("payload").isObject()||!frame.path("payload").path("id").isTextual()||frame.path("payload").path("id").asText().length()>64||frame.toString().getBytes(java.nio.charset.StandardCharsets.UTF_8).length>2048)
            throw ChatService.field("payload","lab:ping requires payload.id and a maximum 2048-byte envelope");
        limits.check(user.sessionId(),"lab",20,1000);
        var state=state(user);synchronized(state){
            var event=Map.<String,Object>of("type","lab:pong","payload",frame.path("payload"),"ts",Instant.now().toString(),"sequence",++state.sequence);
            state.history.addLast(event);while(state.history.size()>256)state.history.removeFirst();
            for(var waiter:List.copyOf(state.waiting)) {waiter.response.setResult(page(state,waiter.after));}state.waiting.clear();
            for(var stream:List.copyOf(state.streams))try{stream.send(SseEmitter.event().id(Long.toString(state.sequence)).name("lab:pong").data(event));}catch(IOException|IllegalStateException e){state.streams.remove(stream);stream.complete();}
            return event;
        }
    }
    private Object page(State state,long after){
        if(after<0||after>state.sequence)throw ChatService.field("after","Cursor out of range");
        long oldest=state.history.isEmpty()?state.sequence+1:(long)state.history.getFirst().get("sequence");
        return Map.of("events",state.history.stream().filter(e->(long)e.get("sequence")>after).toList(),"nextCursor",state.sequence,"resetRequired",after<oldest-1);
    }
    public Object poll(SessionPrincipal user,long after){var state=state(user);synchronized(state){return page(state,after);}}
    public DeferredResult<Object> waitFor(SessionPrincipal user,long after){
        var state=state(user);synchronized(state){
            var result=new DeferredResult<Object>(Math.max(1L,Math.min(25000L,java.time.Duration.between(Instant.now(),user.expiresAt()).toMillis())));page(state,after);
            if(after<state.sequence){result.setResult(page(state,after));return result;}
            if(state.waiting.size()>=2)throw ChatService.field("connection","Maximum two pending long polls per auth session");
            var waiter=new Waiting(after,result);state.waiting.add(waiter);
            result.onTimeout(()->{synchronized(state){result.setResult(page(state,after));}});
            result.onCompletion(()->{synchronized(state){state.waiting.remove(waiter);}});return result;
        }
    }
    public SseEmitter stream(SessionPrincipal user,long after)throws IOException{
        var state=state(user);synchronized(state){
            page(state,after);if(state.streams.size()>=2)throw ChatService.field("connection","Maximum two SSE streams per auth session");
            var stream=new SseEmitter(Math.max(1L,Math.min(60000L,java.time.Duration.between(Instant.now(),user.expiresAt()).toMillis())));state.streams.add(stream);
            Runnable cleanup=()->{synchronized(state){state.streams.remove(stream);}};stream.onCompletion(cleanup);stream.onTimeout(()->{cleanup.run();stream.complete();});stream.onError(e->cleanup.run());
            stream.send(SseEmitter.event().name("ready").data(page(state,after)));return stream;
        }
    }
    @Scheduled(fixedDelay=1000) public void clean(){states.forEach((id,state)->{
        try{auth.validate(state.user);}catch(dev.pulsechat.common.ApiException e){synchronized(state){List.copyOf(state.waiting).forEach(w->w.response.setErrorResult(new dev.pulsechat.common.ApiException(401,"unauthorized",null,"Lab session expired")));List.copyOf(state.streams).forEach(SseEmitter::complete);states.remove(id);limits.forget(id);}}
    });}
}
