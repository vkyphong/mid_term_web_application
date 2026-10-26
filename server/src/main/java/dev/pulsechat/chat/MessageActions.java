package dev.pulsechat.chat;

import java.sql.Timestamp;
import java.time.Instant;
import java.nio.charset.StandardCharsets;
import java.util.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import dev.pulsechat.common.ApiException;
import dev.pulsechat.realtime.RealtimeEvents;

@Service
@Transactional
public class MessageActions {
    private final JdbcTemplate db; private final ChatService chat; private final RealtimeEvents events;
    public MessageActions(JdbcTemplate db,ChatService chat,RealtimeEvents events){this.db=db;this.chat=chat;this.events=events;}
    public Object change(String user,String id,String action,String content,String emoji,boolean active) {
        var rooms=db.query("SELECT room_id FROM messages WHERE id=?",(rs,n)->rs.getString(1),id);
        if(rooms.isEmpty()) throw ChatService.field("messageId","Message not found");
        db.queryForList("SELECT id FROM rooms WHERE id=? FOR UPDATE",rooms.getFirst());
        var message=chat.message(id,user); Timestamp now=Timestamp.from(Instant.now());
        if(action.equals("delivered")||action.equals("seen")) {
            if(db.queryForObject("SELECT COUNT(*) FROM message_receipts WHERE message_id=? AND user_id=?",Integer.class,id,user)==0)
                throw new ApiException(403,"forbidden",null,"Only original recipients may acknowledge a message");
            db.update("UPDATE message_receipts SET delivered_at=COALESCE(delivered_at,?)"+(action.equals("seen")?",seen_at=COALESCE(seen_at,?)":"")+" WHERE message_id=? AND user_id=?",
                action.equals("seen")?new Object[]{now,now,id,user}:new Object[]{now,id,user});
        } else {
            if(!action.equals("react")&&!message.sender().id().equals(user))throw new ApiException(403,"forbidden",null,"Only the author may edit or delete");
            if(message.deletedAt()!=null && !action.equals("delete"))throw ChatService.field("messageId","Message was deleted");
            switch(action) {
                case "edit" -> {
                    if(content==null||content.isBlank()||content.trim().getBytes(StandardCharsets.UTF_8).length>2048)throw ChatService.field("content","Use 1–2048 UTF-8 bytes");
                    db.update("UPDATE messages SET content=?,edited_at=? WHERE id=?",content.trim(),now,id);
                }
                case "delete" -> {db.update("UPDATE messages SET content='',deleted_at=COALESCE(deleted_at,?) WHERE id=?",now,id);db.update("DELETE FROM message_reactions WHERE message_id=?",id);}
                case "react" -> {
                    if(!Set.of("👍","❤️","😂","😮","😢","🎉").contains(emoji))throw ChatService.field("emoji","Unsupported reaction");
                    if(active) {if(db.queryForObject("SELECT COUNT(*) FROM message_reactions WHERE message_id=? AND user_id=? AND emoji=?",Integer.class,id,user,emoji)==0)
                        db.update("INSERT INTO message_reactions(message_id,user_id,emoji) VALUES (?,?,?)",id,user,emoji);
                    } else db.update("DELETE FROM message_reactions WHERE message_id=? AND user_id=? AND emoji=?",id,user,emoji);
                }
                default -> throw ChatService.field("action","Unknown action");
            }
        }
        var updated=chat.message(id,user);
        events.send(chat.recipients(message.roomId()),"/queue/events","message:"+action,updated);
        return updated;
    }
    public Object receipts(String user,String id) {
        chat.message(id,user);
        return db.query("SELECT user_id,delivered_at,seen_at FROM message_receipts WHERE message_id=? ORDER BY user_id",(rs,n)->{
            Map<String,Object> r=new LinkedHashMap<>();r.put("userId",rs.getString(1));r.put("deliveredAt",rs.getTimestamp(2)==null?null:rs.getTimestamp(2).toInstant());r.put("seenAt",rs.getTimestamp(3)==null?null:rs.getTimestamp(3).toInstant());return r;
        },id);
    }
}
