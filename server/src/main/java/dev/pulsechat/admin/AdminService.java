package dev.pulsechat.admin;

import java.util.*;
import java.time.Instant;
import java.sql.Timestamp;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.scheduling.annotation.*;
import dev.pulsechat.common.ApiException;
import dev.pulsechat.chat.ChatService;
import dev.pulsechat.notification.NotificationService;
import dev.pulsechat.realtime.*;

@Service
@EnableScheduling
public class AdminService {
    private final JdbcTemplate db;private final ConnectionRegistry connections;private final RealtimeEvents events;private final NotificationService notifications;
    public AdminService(JdbcTemplate db,ConnectionRegistry connections,RealtimeEvents events,NotificationService notifications){this.db=db;this.connections=connections;this.events=events;this.notifications=notifications;}
    public void requireAdmin(String user){if(db.queryForObject("SELECT COUNT(*) FROM users WHERE id=? AND role='admin' AND enabled=true",Integer.class,user)!=1)throw new ApiException(403,"forbidden",null,"Administrator role required");}
    public Object stats(String user){requireAdmin(user);return snapshot();}
    public record AdminUser(String id,String email,String displayName,String role,boolean enabled,boolean online) {}
    public record UserPage(List<AdminUser> users,int total,int page,int pageSize) {}
    public record ChannelActivity(String id,String name,int members,int messagesLastMinute,String lastMessageAt) {}
    public UserPage users(String admin,String search,int page){
        requireAdmin(admin);
        if(page<0||page>100000||search.length()>254)throw ChatService.field("search","Invalid search or page");
        // Literal substring search: '%' and '_' in input are not SQL wildcards.
        String pattern="%"+search.strip().toLowerCase(Locale.ROOT).replace("!","!!").replace("%","!%").replace("_","!_")+"%";
        String where=" WHERE LOWER(email) LIKE ? ESCAPE '!' OR LOWER(display_name) LIKE ? ESCAPE '!'";
        int total=db.queryForObject("SELECT COUNT(*) FROM users"+where,Integer.class,pattern,pattern);
        var online=connections.onlineUsers();
        var users=db.query("SELECT id,email,display_name,role,enabled FROM users"+where+" ORDER BY display_name,id LIMIT 20 OFFSET ?",
            (rs,n)->new AdminUser(rs.getString("id"),rs.getString("email"),rs.getString("display_name"),rs.getString("role"),rs.getBoolean("enabled"),online.contains(rs.getString("id"))),pattern,pattern,page*20);
        return new UserPage(users,total,page,20);
    }
    public Object channels(String admin){
        requireAdmin(admin);
        var cutoff=Timestamp.from(Instant.now().minusSeconds(60));
        // Only public channel metadata; do not expose DM participants or message content.
        var channels=db.query("""
            SELECT r.id,r.name,r.last_message_at,
              (SELECT COUNT(*) FROM room_members rm WHERE rm.room_id=r.id) AS members,
              (SELECT COUNT(*) FROM messages m WHERE m.room_id=r.id AND m.created_at>=?) AS recent_messages
            FROM rooms r WHERE r.type='channel' AND r.last_message_at>=?
            ORDER BY r.last_message_at DESC,r.id LIMIT 50
            """,(rs,n)->new ChannelActivity(rs.getString("id"),rs.getString("name"),rs.getInt("members"),rs.getInt("recent_messages"),rs.getTimestamp("last_message_at").toInstant().toString()),cutoff,cutoff);
        return Map.of("channels",channels);
    }
    private Object snapshot(){return Map.of("connections",connections.authenticatedCount(),"onlineUsers",connections.onlineUsers().size(),
        "msgPerSec",db.queryForObject("SELECT COUNT(*) FROM messages WHERE created_at>=?",Integer.class,Timestamp.from(Instant.now().minusSeconds(1))),
        "activeRooms",db.queryForObject("SELECT COUNT(*) FROM rooms WHERE last_message_at>=?",Integer.class,Timestamp.from(Instant.now().minusSeconds(60))));}
    @Scheduled(fixedDelay=1000) public void push(){
        var admins=db.query("SELECT id FROM users WHERE role='admin' AND enabled=true",(rs,n)->rs.getString(1));
        if(!admins.isEmpty())events.send(admins,"/queue/admin","admin:stats",snapshot());
    }
    public void kick(String admin,String target){requireAdmin(admin);requireUser(target);connections.kick(target);}
    @Transactional public void ban(String admin,String target){
        requireAdmin(admin);requireUser(target);if(admin.equals(target))throw ChatService.field("userId","Cannot ban yourself");
        db.update("UPDATE users SET enabled=false WHERE id=?",target);
        db.update("UPDATE auth_sessions SET revoked=true WHERE user_id=?",target);
        org.springframework.transaction.support.TransactionSynchronizationManager.registerSynchronization(new org.springframework.transaction.support.TransactionSynchronization(){@Override public void afterCommit(){connections.kick(target);}});
    }
    @Transactional public Object broadcast(String admin,String content){
        requireAdmin(admin);if(content==null||content.isBlank()||content.getBytes(java.nio.charset.StandardCharsets.UTF_8).length>2048)throw ChatService.field("content","Use 1–2048 UTF-8 bytes");
        var users=db.query("SELECT id FROM users WHERE enabled=true",(rs,n)->rs.getString(1));
        users.forEach(user->notifications.create(user,"system",null,null,content));return Map.of("recipients",users.size());
    }
    private void requireUser(String id){if(db.queryForObject("SELECT COUNT(*) FROM users WHERE id=?",Integer.class,id)!=1)throw ChatService.field("userId","User not found");}
}
