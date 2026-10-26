package dev.pulsechat.notification;

import java.util.*;
import java.sql.Timestamp;
import java.time.Instant;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import dev.pulsechat.realtime.RealtimeEvents;
import dev.pulsechat.chat.ChatService;

@Service
@Transactional
public class NotificationService {
    private final JdbcTemplate db;
    private final RealtimeEvents events;
    public NotificationService(JdbcTemplate db, RealtimeEvents events) { this.db=db; this.events=events; }
    public void create(String user,String type,String room,String message,String content) {
        String id=UUID.randomUUID().toString();
        db.update("INSERT INTO notifications(id,user_id,type,room_id,message_id,content,created_at) VALUES (?,?,?,?,?,?,?)",id,user,type,room,message,content,Timestamp.from(Instant.now()));
        events.send(List.of(user),"/queue/notifications","notification:new",view(id));
    }
    private Map<String,Object> view(String id) {
        return db.queryForObject("SELECT * FROM notifications WHERE id=?",(rs,n)-> {
            Map<String,Object> result=new LinkedHashMap<>();
            result.put("id",rs.getString("id")); result.put("type",rs.getString("type")); result.put("roomId",rs.getString("room_id"));
            result.put("messageId",rs.getString("message_id")); result.put("content",rs.getString("content"));
            result.put("createdAt",rs.getTimestamp("created_at").toInstant()); result.put("readAt",rs.getTimestamp("read_at")==null?null:rs.getTimestamp("read_at").toInstant()); return result;
        },id);
    }
    private static final String VISIBLE=" user_id=? AND (room_id IS NULL OR EXISTS (SELECT 1 FROM room_members m WHERE m.room_id=notifications.room_id AND m.user_id=notifications.user_id))";
    public Object list(String user,int limit,String before) {
        if(limit<1||limit>100) throw ChatService.field("limit","Use 1–100");
        String clause=""; List<Object> args=new ArrayList<>();args.add(user);
        if(before!=null) {
            var cursor=db.query("SELECT created_at FROM notifications WHERE id=? AND"+VISIBLE,(rs,n)->rs.getTimestamp(1),before,user);
            if(cursor.isEmpty()) throw ChatService.field("before","Invalid notification ID cursor");
            clause=" AND (created_at<? OR (created_at=? AND id<?))";args.add(cursor.getFirst());args.add(cursor.getFirst());args.add(before);
        }
        args.add(limit+1);
        var ids=new ArrayList<>(db.query("SELECT id FROM notifications WHERE"+VISIBLE+clause+" ORDER BY created_at DESC,id DESC LIMIT ?",(rs,n)->rs.getString(1),args.toArray()));
        boolean more=ids.size()>limit;if(more)ids.removeLast();
        Map<String,Object> result=new LinkedHashMap<>();result.put("notifications",ids.stream().map(this::view).toList());
        result.put("nextCursor",more?ids.getLast():null);result.put("unreadCount",db.queryForObject("SELECT COUNT(*) FROM notifications WHERE"+VISIBLE+" AND read_at IS NULL",Integer.class,user));return result;
    }
    public void read(String user,String id) {
        if(db.queryForObject("SELECT COUNT(*) FROM notifications WHERE id=? AND"+VISIBLE,Integer.class,id,user)==0) throw ChatService.field("id","Notification not found");
        db.update("UPDATE notifications SET read_at=COALESCE(read_at,?) WHERE id=? AND user_id=?",Timestamp.from(Instant.now()),id,user);
        events.send(List.of(user),"/queue/notifications","notification:read",Map.of("id",id));
    }
}
