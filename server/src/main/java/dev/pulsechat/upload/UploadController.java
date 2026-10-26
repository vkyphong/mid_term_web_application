package dev.pulsechat.upload;

import java.nio.file.*;
import java.io.*;
import java.util.*;
import java.time.Instant;
import java.sql.Timestamp;
import javax.imageio.ImageIO;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.http.*;
import org.springframework.core.io.FileSystemResource;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;
import dev.pulsechat.auth.SessionPrincipal;
import dev.pulsechat.chat.ChatService;
import dev.pulsechat.common.ApiException;

@RestController
@RequestMapping("/api/uploads")
public class UploadController {
    private final Path directory;private final JdbcTemplate db;private final ChatService chat;
    public UploadController(@Value("${app.upload-directory:./uploads}") String directory,JdbcTemplate db,ChatService chat)throws IOException{
        this.directory=Path.of(directory).toAbsolutePath().normalize();Files.createDirectories(this.directory);this.db=db;this.chat=chat;
    }
    @PostMapping(consumes=MediaType.MULTIPART_FORM_DATA_VALUE)
    public ResponseEntity<?> upload(@AuthenticationPrincipal SessionPrincipal user,@RequestParam String roomId,@RequestParam MultipartFile file)throws IOException{
        chat.requireMember(roomId,user.userId());
        if(file.isEmpty()||file.getSize()>5*1024*1024)throw ChatService.field("file","File must contain 1–5242880 bytes");
        byte[] bytes=file.getBytes();String media;
        if(bytes.length>=8&&Arrays.equals(Arrays.copyOf(bytes,8),new byte[]{(byte)137,80,78,71,13,10,26,10}))media="image/png";
        else if(bytes.length>=3&&(bytes[0]&255)==255&&(bytes[1]&255)==216&&(bytes[2]&255)==255)media="image/jpeg";
        else if(bytes.length>=5&&new String(bytes,0,5,java.nio.charset.StandardCharsets.US_ASCII).equals("%PDF-"))media="application/pdf";
        else throw ChatService.field("file","Only JPEG, PNG and PDF signatures are accepted");
        if(media.startsWith("image/")){
            try(var input=ImageIO.createImageInputStream(new ByteArrayInputStream(bytes))){
                var readers=ImageIO.getImageReaders(input);if(!readers.hasNext())throw ChatService.field("file","Invalid image");
                var reader=readers.next();try{reader.setInput(input);if((long)reader.getWidth(0)*reader.getHeight(0)>25_000_000)throw ChatService.field("file","Image exceeds 25 megapixels");
                    if(reader.read(0)==null)throw ChatService.field("file","Invalid image");}finally{reader.dispose();}
            }catch(IOException e){throw ChatService.field("file","Invalid image");}
        }
        String name=Objects.requireNonNullElse(file.getOriginalFilename(),"file").replaceAll("[\\\\/\\p{Cntrl}]","_");
        if(name.isBlank()||name.length()>200)throw ChatService.field("file","Filename must contain 1–200 characters");
        String id=UUID.randomUUID().toString();Path path=directory.resolve(id);
        Files.write(path,bytes,StandardOpenOption.CREATE_NEW);
        try{db.update("INSERT INTO uploads(id,room_id,owner_id,filename,media_type,size_bytes,created_at) VALUES (?,?,?,?,?,?,?)",id,roomId,user.userId(),name,media,bytes.length,Timestamp.from(Instant.now()));}
        catch(RuntimeException e){Files.deleteIfExists(path);throw e;}
        return ResponseEntity.status(201).body(Map.of("id",id,"roomId",roomId,"filename",name,"mediaType",media,"size",bytes.length,"url","/api/uploads/"+id));
    }
    @GetMapping("/{id}") public ResponseEntity<FileSystemResource> download(@AuthenticationPrincipal SessionPrincipal user,@PathVariable String id){
        var rows=db.queryForList("SELECT u.*,m.deleted_at FROM uploads u LEFT JOIN messages m ON m.id=u.message_id WHERE u.id=?",id);
        if(rows.isEmpty())throw new ApiException(404,"invalid_payload","not_found","File not found");
        var file=rows.getFirst();chat.requireMember((String)file.get("room_id"),user.userId());
        if(file.get("deleted_at")!=null||(file.get("message_id")==null&&!user.userId().equals(file.get("owner_id"))))throw new ApiException(403,"forbidden",null,"File is not available");
        Path path=directory.resolve(id).normalize();if(!path.getParent().equals(directory)||!Files.isRegularFile(path))throw new ApiException(404,"invalid_payload","not_found","File not found");
        return ResponseEntity.ok().contentType(MediaType.parseMediaType((String)file.get("media_type")))
            .header("Content-Disposition",ContentDisposition.attachment().filename((String)file.get("filename"),java.nio.charset.StandardCharsets.UTF_8).build().toString())
            .header("Cache-Control","no-store").header("X-Content-Type-Options","nosniff").header("Content-Security-Policy","sandbox")
            .body(new FileSystemResource(path));
    }
}
