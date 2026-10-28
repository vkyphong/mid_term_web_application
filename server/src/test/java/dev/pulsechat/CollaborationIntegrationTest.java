package dev.pulsechat;

import com.fasterxml.jackson.databind.*;
import dev.pulsechat.auth.*;
import dev.pulsechat.chat.*;
import dev.pulsechat.realtime.*;
import dev.pulsechat.admin.AdminService;
import dev.pulsechat.common.ApiException;
import java.net.URI;
import java.net.http.*;
import java.util.*;
import java.util.concurrent.*;
import java.time.Duration;
import org.junit.jupiter.api.*;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.jdbc.core.JdbcTemplate;
import static org.assertj.core.api.Assertions.*;
import static org.awaitility.Awaitility.await;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

@SpringBootTest(webEnvironment=SpringBootTest.WebEnvironment.RANDOM_PORT,properties={"app.access-ttl-seconds=900","app.upload-directory=${java.io.tmpdir}/pulsechat-test-uploads"})
@AutoConfigureMockMvc
@ActiveProfiles("test")
class CollaborationIntegrationTest {
    @Autowired MockMvc mvc;@Autowired ObjectMapper mapper;@Autowired AuthService auth;@Autowired ChatService chat;
    @Autowired MessageActions actions;@Autowired JdbcTemplate db;@Autowired ConnectionRegistry connections;@Autowired AdminService admin;
    @LocalServerPort int port;
    record Account(String id,String token,String refresh){}
    Account a,b,c;String room;
    @BeforeEach void setup(){a=account();b=account();c=account();room=chat.createRoom(a.id(),new ChatDtos.CreateRoom("Feature-"+UUID.randomUUID().toString().substring(0,20),null)).id();chat.join(room,b.id());}
    Account account(){var issued=auth.register(new AuthDtos.RegisterInput("feature-"+UUID.randomUUID()+"@DQGM.dev","Feature Employee","Password123"));return new Account(issued.response().user().id(),issued.response().accessToken(),issued.refreshToken());}
    JsonNode getJson(String path,Account user,int status)throws Exception{return mapper.readTree(mvc.perform(get(path).header("Authorization","Bearer "+user.token())).andExpect(status().is(status)).andReturn().getResponse().getContentAsString());}
    JsonNode postJson(String path,Account user,Object body,int status)throws Exception{
        String result=mvc.perform(post(path).header("Authorization","Bearer "+user.token()).contentType("application/json").content(mapper.writeValueAsString(body))).andExpect(status().is(status)).andReturn().getResponse().getContentAsString();return result.isEmpty()?mapper.createObjectNode():mapper.readTree(result);
    }
    @Test void receiptsAreRecipientScopedMonotonicAndSnapshotBased()throws Exception{
        var message=chat.send(room,a.id(),"hello",UUID.randomUUID().toString()).message();
        assertThatThrownBy(()->actions.change(a.id(),message.id(),"seen",null,"",false)).isInstanceOf(ApiException.class);
        actions.change(b.id(),message.id(),"seen",null,"",false);actions.change(b.id(),message.id(),"delivered",null,"",false);
        chat.join(room,c.id());assertThatThrownBy(()->actions.change(c.id(),message.id(),"seen",null,"",false)).isInstanceOf(ApiException.class);
        var receipts=getJson("/api/messages/"+message.id()+"/receipts",b,200);
        assertThat(receipts.size()).isEqualTo(1);assertThat(receipts.get(0).path("seenAt").isTextual()).isTrue();assertThat(receipts.get(0).path("deliveredAt").isTextual()).isTrue();
    }
    @Test void notificationRetryVisibilityReadAndMentionValidation()throws Exception{
        String key=UUID.randomUUID().toString();
        chat.send(room,a.id(),"mention",key,null,List.of(b.id()));chat.send(room,a.id(),"mention",key,null,List.of(b.id()));
        var list=getJson("/api/notifications",b,200);assertThat(list.path("unreadCount").asInt()).isEqualTo(1);
        String notification=list.at("/notifications/0/id").asText();postJson("/api/notifications/"+notification+"/read",c,Map.of(),400);
        postJson("/api/notifications/"+notification+"/read",b,Map.of(),200);assertThat(getJson("/api/notifications",b,200).path("unreadCount").asInt()).isZero();
        assertThatThrownBy(()->chat.send(room,a.id(),"invalid mention",UUID.randomUUID().toString(),null,List.of(c.id()))).isInstanceOf(ApiException.class);
        chat.leave(room,b.id());assertThat(getJson("/api/notifications",b,200).path("notifications").size()).isZero();
    }
    @Test void globalRetryKeyIsConcurrentAndRejectsAnotherRoom()throws Exception{
        String other=chat.createRoom(a.id(),new ChatDtos.CreateRoom("Other-"+UUID.randomUUID().toString().substring(0,20),null)).id();String key=UUID.randomUUID().toString();
        try(var pool=Executors.newFixedThreadPool(2)){
            var start=new CountDownLatch(1);var one=pool.submit(()->{start.await();return chat.send(room,a.id(),"same",key);});var two=pool.submit(()->{start.await();return chat.send(room,a.id(),"same",key);});start.countDown();
            assertThat(one.get(10,TimeUnit.SECONDS).message().id()).isEqualTo(two.get(10,TimeUnit.SECONDS).message().id());
        }
        assertThatThrownBy(()->chat.send(other,a.id(),"different",key)).isInstanceOf(ApiException.class).hasMessageContaining("Invalid request");
        assertThat(db.queryForObject("SELECT COUNT(*) FROM messages WHERE sender_id=? AND client_msg_id=?",Integer.class,a.id(),key)).isEqualTo(1);
    }
    @Test void editDeleteAndReactionAreAuthorizedAndIdempotent(){
        var m=chat.send(room,a.id(),"original",UUID.randomUUID().toString()).message();
        assertThatThrownBy(()->actions.change(b.id(),m.id(),"edit","attack","",false)).isInstanceOf(ApiException.class);
        actions.change(a.id(),m.id(),"edit","<script>alert(1)</script>","",false);
        assertThat(chat.message(m.id(),a.id()).content()).isEqualTo("<script>alert(1)</script>");
        for(int i=0;i<2;i++)actions.change(b.id(),m.id(),"react",null,"👍",true);
        assertThat(db.queryForObject("SELECT COUNT(*) FROM message_reactions WHERE message_id=?",Integer.class,m.id())).isEqualTo(1);
        actions.change(b.id(),m.id(),"react",null,"👍",false);actions.change(a.id(),m.id(),"delete",null,"",false);
        assertThat(chat.message(m.id(),b.id()).content()).isEmpty();assertThat(chat.message(m.id(),b.id()).deletedAt()).isNotNull();
        assertThatThrownBy(()->actions.change(a.id(),m.id(),"edit","revive","",false)).isInstanceOf(ApiException.class);
    }
    @Test void uploadRequiresMembershipAndCanAttachOnlyOnce()throws Exception{
        byte[] pdf="%PDF-1.4\nDemo\n%%EOF".getBytes(java.nio.charset.StandardCharsets.US_ASCII);
        var upload=mapper.readTree(mvc.perform(multipart("/api/uploads").file(new MockMultipartFile("file","demo.pdf","application/pdf",pdf)).param("roomId",room).header("Authorization","Bearer "+a.token())).andExpect(status().isCreated()).andReturn().getResponse().getContentAsString());
        String id=upload.path("id").asText();getJson("/api/uploads/"+id,b,403);getJson("/api/uploads/"+id,c,403);
        String key=UUID.randomUUID().toString();var m=chat.send(room,a.id(),"",key,id,List.of()).message();chat.send(room,a.id(),"",key,id,List.of());
        mvc.perform(get("/api/uploads/"+id).header("Authorization","Bearer "+b.token())).andExpect(status().isOk()).andExpect(header().string("X-Content-Type-Options","nosniff"));
        assertThatThrownBy(()->chat.send(room,a.id(),"",UUID.randomUUID().toString(),id,List.of())).isInstanceOf(ApiException.class);
        actions.change(a.id(),m.id(),"delete",null,"",false);getJson("/api/uploads/"+id,b,403);
        mvc.perform(multipart("/api/uploads").file(new MockMultipartFile("file","fake.png","image/png","<html>".getBytes())).param("roomId",room).header("Authorization","Bearer "+a.token())).andExpect(status().isBadRequest());
        byte[] boundary=new byte[5*1024*1024];System.arraycopy(pdf,0,boundary,0,pdf.length);
        mvc.perform(multipart("/api/uploads").file(new MockMultipartFile("file","max.pdf","application/pdf",boundary)).param("roomId",room).header("Authorization","Bearer "+a.token())).andExpect(status().isCreated());
        mvc.perform(multipart("/api/uploads").file(new MockMultipartFile("file","large.pdf","application/pdf",new byte[5*1024*1024+1])).param("roomId",room).header("Authorization","Bearer "+a.token())).andExpect(status().isBadRequest());
    }
    @Test void presenceTracksLastSocketAndAdminBanRevokesRefresh()throws Exception{
        db.update("UPDATE users SET role='admin' WHERE id=?",c.id());
        try(var first=new Socket(a);var second=new Socket(a)){
            await().atMost(Duration.ofSeconds(3)).until(()->connections.onlineUsers().contains(a.id()));first.close();
            assertThat(connections.onlineUsers()).contains(a.id());
            getJson("/api/admin/stats",a,403);assertThat(getJson("/api/admin/stats",c,200).path("connections").asInt()).isGreaterThanOrEqualTo(1);
            postJson("/api/admin/users/"+a.id()+"/ban",c,Map.of(),200);
            await().atMost(Duration.ofSeconds(3)).until(()->!connections.onlineUsers().contains(a.id()));
            assertThatThrownBy(()->auth.refresh(a.refresh())).isInstanceOf(ApiException.class);
            getJson("/api/auth/me",a,401);
        }
        assertThat(db.queryForObject("SELECT last_seen FROM users WHERE id=?",java.sql.Timestamp.class,a.id())).isNotNull();
    }
    JsonNode searchAdminUsers(Account admin,int page)throws Exception{
        return mapper.readTree(mvc.perform(get("/api/admin/users").param("search","Literal%_").param("page",String.valueOf(page))
            .header("Authorization","Bearer "+admin.token())).andExpect(status().isOk()).andReturn().getResponse().getContentAsString());
    }
    @Test void adminListsSafeAccountFieldsAndRecentPublicChannels()throws Exception{
        getJson("/api/admin/users",a,403);getJson("/api/admin/channels",a,403);
        mvc.perform(get("/api/admin/users")).andExpect(status().isUnauthorized());
        db.update("UPDATE users SET role='admin' WHERE id=?",c.id());
        db.update("UPDATE users SET display_name='Literal%_Employee' WHERE id=?",a.id());
        try(var socket=new Socket(a)){
            var users=searchAdminUsers(c,0);
            assertThat(users.path("total").asInt()).isEqualTo(1);
            assertThat(users.at("/users/0/id").asText()).isEqualTo(a.id());
            assertThat(users.at("/users/0/online").asBoolean()).isTrue();
            assertThat(users.at("/users/0/enabled").asBoolean()).isTrue();
            assertThat(users.at("/users/0").size()).isEqualTo(6);
            assertThat(searchAdminUsers(c,1).path("users").size()).isZero();
            getJson("/api/admin/users?page=-1",c,400);
        }
        var dm=chat.openDm(a.id(),new ChatDtos.OpenDm(b.id()));
        chat.send(dm.id(),a.id(),"Private",UUID.randomUUID().toString());
        chat.send(room,a.id(),"Public",UUID.randomUUID().toString());
        var channels=getJson("/api/admin/channels",c,200).path("channels");
        assertThat(channels.findValuesAsText("id")).contains(room).doesNotContain(dm.id());
        JsonNode channel=null;for(var item:channels)if(item.path("id").asText().equals(room))channel=item;
        assertThat(channel).isNotNull();assertThat(channel.path("messagesLastMinute").asInt()).isEqualTo(1);
        assertThat(channel.path("members").asInt()).isEqualTo(2);
        db.update("UPDATE rooms SET last_message_at=? WHERE id=?",java.sql.Timestamp.from(java.time.Instant.now().minusSeconds(120)),room);
        assertThat(getJson("/api/admin/channels",c,200).path("channels").findValuesAsText("id")).doesNotContain(room);
        postJson("/api/admin/users/"+a.id()+"/ban",c,Map.of(),200);
        var banned=searchAdminUsers(c,0).at("/users/0");
        assertThat(banned.path("enabled").asBoolean()).isFalse();assertThat(banned.path("online").asBoolean()).isFalse();
        db.update("UPDATE users SET role='user' WHERE id=?",c.id());getJson("/api/admin/users",c,403);
    }
    @Test void typingAndMessageActionsUsePrivateQueuesAndRateLimits()throws Exception{
        try(var sender=new Socket(a);var receiver=new Socket(b);var outsider=new Socket(c)){
            receiver.subscribe("typing");outsider.subscribe("typing");receiver.barrier();outsider.barrier();
            assertThat(sender.request("typing.start",Map.of("roomId",room)).at("/payload/ok").asBoolean()).isTrue();
            assertThat(receiver.event("typing:start").at("/payload/userId").asText()).isEqualTo(a.id());outsider.barrier();
            assertThat(outsider.request("typing.start",Map.of("roomId",room)).at("/payload/error/code").asText()).isEqualTo("forbidden");
            for(int i=0;i<10;i++)assertThat(sender.request("message.send",Map.of("roomId",room,"content","hello","clientMsgId",UUID.randomUUID().toString())).at("/payload/ok").asBoolean()).isTrue();
            assertThat(sender.request("message.send",Map.of("roomId",room,"content","limited","clientMsgId",UUID.randomUUID().toString())).at("/payload/error/code").asText()).isEqualTo("rate_limited");
        }
    }
    @Test void limiterWindowResets()throws Exception{
        var limiter=new SessionRateLimiter();for(int i=0;i<10;i++)limiter.check("test","messages",10,50);
        assertThatThrownBy(()->limiter.check("test","messages",10,50)).isInstanceOf(ApiException.class);
        Thread.sleep(70);assertThatCode(()->limiter.check("test","messages",10,50)).doesNotThrowAnyException();
    }
    @Test void adminBroadcastIsPersistentAndKickAllowsReconnect()throws Exception{
        db.update("UPDATE users SET role='admin' WHERE id=?",c.id());
        try(var target=new Socket(a)){
            postJson("/api/admin/users/"+a.id()+"/kick",c,Map.of(),200);
            await().atMost(Duration.ofSeconds(3)).until(()->!connections.onlineUsers().contains(a.id()));
        }
        try(var reconnect=new Socket(a)){assertThat(connections.onlineUsers()).contains(a.id());}
        postJson("/api/admin/broadcast",a,Map.of("content","forbidden"),403);
        postJson("/api/admin/broadcast",c,Map.of("content","Maintenance notice"),200);
        assertThat(getJson("/api/notifications",b,200).at("/notifications/0/type").asText()).isEqualTo("system");
        postJson("/api/admin/users/"+c.id()+"/ban",c,Map.of(),400);
    }
    @Test void historyThirtyMessageBoundaryAndReceiptCountNames()throws Exception{
        for(int i=0;i<31;i++)chat.send(room,a.id(),"Page "+i,UUID.randomUUID().toString());
        var newest=getJson("/api/rooms/"+room+"/messages",b,200);
        assertThat(newest.path("messages").size()).isEqualTo(30);assertThat(newest.at("/messages/0/receipts/recipients").asInt()).isEqualTo(1);
        var older=getJson("/api/rooms/"+room+"/messages?before="+newest.path("nextCursor").asText(),b,200);
        assertThat(older.path("messages").size()).isEqualTo(1);
        assertThat(newest.path("messages").findValuesAsText("id")).doesNotContain(older.at("/messages/0/id").asText());
    }
    @Test void oversizedStompFrameClosesTransport()throws Exception{
        try(var socket=new Socket(a)){
            socket.socket.sendText("SEND\ndestination:/app/message.send\n\n"+"x".repeat(1024*1024)+"\0",true).exceptionally(e->null).join();
            assertThat(socket.closed.get(10,TimeUnit.SECONDS)).isNotNull();
        }
    }
    @Test void labPollingUsesSessionScopedCursorAndValidatesPayload()throws Exception{
        var pong=postJson("/api/lab/ping",a,Map.of("type","lab:ping","payload",Map.of("id","one","text","hello"),"ts",java.time.Instant.now().toString(),"correlationId","correlation-one"),200);
        assertThat(pong.path("correlationId").asText()).isEqualTo("correlation-one");
        assertThat(pong.path("ts").asText()).isNotBlank();
        assertThat(getJson("/api/lab/poll",a,200).path("events").size()).isEqualTo(1);
        assertThat(getJson("/api/lab/poll",b,200).path("events").size()).isZero();
        assertThat(getJson("/api/lab/poll?after=1",a,200).path("events").size()).isZero();
        getJson("/api/lab/poll?after=-1",a,400);postJson("/api/lab/ping",a,Map.of("type","wrong"),400);
        postJson("/api/lab/ping",a,Map.of("type","lab:ping","payload",Map.of("id","invalid"),"correlationId",42),400);
        postJson("/api/lab/ping",a,Map.of("type","lab:ping","payload",Map.of("id","invalid"),"correlationId","x".repeat(65)),400);
        var pending=mvc.perform(get("/api/lab/long-poll?after=1").header("Authorization","Bearer "+a.token())).andExpect(request().asyncStarted()).andReturn();
        postJson("/api/lab/ping",a,Map.of("type","lab:ping","payload",Map.of("id","two"),"correlationId","correlation-two"),200);
        mvc.perform(asyncDispatch(pending)).andExpect(status().isOk()).andExpect(jsonPath("$.events[0].payload.id").value("two")).andExpect(jsonPath("$.events[0].correlationId").value("correlation-two"));
    }
    class Socket implements WebSocket.Listener,AutoCloseable{
        final CompletableFuture<Integer> closed=new CompletableFuture<>();
        final BlockingQueue<String> frames=new LinkedBlockingQueue<>();final StringBuilder buffer=new StringBuilder();final WebSocket socket;int subscriptions;
        Socket(Account user)throws Exception{
            socket=HttpClient.newHttpClient().newWebSocketBuilder().header("Origin","http://localhost:"+port).subprotocols("v12.stomp").buildAsync(URI.create("ws://localhost:"+port+"/ws"),this).join();
            send("CONNECT\naccept-version:1.2\nhost:localhost\nAuthorization:Bearer "+user.token()+"\n\n");assertThat(raw()).startsWith("CONNECTED");subscribe("acks");subscribe("session");barrier();
        }
        void subscribe(String queue){send("SUBSCRIBE\nid:"+subscriptions+++"\ndestination:/user/queue/"+queue+"\n\n");}
        void send(String frame){socket.sendText(frame+"\0",true).join();}
        String raw()throws Exception{String result=frames.poll(5,TimeUnit.SECONDS);assertThat(result).isNotNull();return result;}
        JsonNode next()throws Exception{String frame=raw();assertThat(frame).startsWith("MESSAGE");return mapper.readTree(frame.substring(frame.indexOf("\n\n")+2));}
        JsonNode event(String type)throws Exception{var event=next();assertThat(event.path("type").asText()).isEqualTo(type);return event;}
        void barrier()throws Exception{send("SEND\ndestination:/app/session/ping\n\n{}");event("session:pong");}
        JsonNode request(String destination,Object payload)throws Exception{send("SEND\ndestination:/app/"+destination+"\ncontent-type:application/json\n\n"+mapper.writeValueAsString(Map.of("type",destination.replace('.',':'),"payload",payload,"correlationId",UUID.randomUUID().toString(),"ts",java.time.Instant.now().toString())));return event("ack");}
        public void onOpen(WebSocket socket){socket.request(1);}
        public CompletionStage<?> onClose(WebSocket socket,int status,String reason){closed.complete(status);return null;}
        public void onError(WebSocket socket,Throwable error){closed.complete(-1);}
        public CompletionStage<?> onText(WebSocket socket,CharSequence data,boolean last){buffer.append(data);int end;while((end=buffer.indexOf("\0"))>=0){String frame=buffer.substring(0,end).stripLeading();buffer.delete(0,end+1);if(!frame.isBlank())frames.add(frame);}socket.request(1);return null;}
        public void close(){socket.abort();}
    }
}
