package dev.pulsechat.presence;

import java.util.*;
import java.time.Instant;
import java.sql.Timestamp;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.context.event.EventListener;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;
import dev.pulsechat.auth.SessionPrincipal;
import dev.pulsechat.realtime.*;

@RestController
public class PresenceController {
    private final JdbcTemplate db;private final ConnectionRegistry connections;private final RealtimeEvents events;
    public PresenceController(JdbcTemplate db,ConnectionRegistry connections,RealtimeEvents events){this.db=db;this.connections=connections;this.events=events;}
    @GetMapping("/api/presence")
    public Object presence(@AuthenticationPrincipal SessionPrincipal user){
        var online=connections.onlineUsers();
        return Map.of("users",db.query("SELECT id,last_seen FROM users WHERE enabled=true ORDER BY id",(rs,n)->{
            Map<String,Object> result=new LinkedHashMap<>();result.put("userId",rs.getString(1));result.put("online",online.contains(rs.getString(1)));result.put("lastSeen",rs.getTimestamp(2)==null?null:rs.getTimestamp(2).toInstant());return result;
        }));
    }
    @EventListener public void changed(ConnectionRegistry.PresenceChanged change){
        Instant now=Instant.now();
        if(!change.online())db.update("UPDATE users SET last_seen=? WHERE id=?",Timestamp.from(now),change.userId());
        Map<String,Object> payload=new LinkedHashMap<>();payload.put("userId",change.userId());payload.put("online",change.online());
        var last=db.query("SELECT last_seen FROM users WHERE id=?",(rs,n)->rs.getTimestamp(1),change.userId());
        payload.put("lastSeen",last.isEmpty()||last.getFirst()==null?null:last.getFirst().toInstant());
        events.send(connections.onlineUsers(),"/queue/presence","presence:update",payload);
    }
}
