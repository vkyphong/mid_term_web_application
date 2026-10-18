package dev.pulsechat.common;

import java.util.Map;
import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.dao.DataIntegrityViolationException;

@RestControllerAdvice
public class ApiErrors {
    public record ErrorBody(String code, String reason, String message, Object details) {}
    public static Map<String, ErrorBody> body(ApiException e) {
        return Map.of("error", new ErrorBody(e.code, e.reason, e.getMessage(), e.details));
    }
    public static void write(HttpServletResponse response, ObjectMapper mapper, ApiException e) throws IOException {
        response.setStatus(e.status); response.setContentType("application/json");
        mapper.writeValue(response.getOutputStream(), body(e));
    }
    @ExceptionHandler(ApiException.class)
    ResponseEntity<?> api(ApiException e) { return ResponseEntity.status(e.status).body(body(e)); }
    @ExceptionHandler(MethodArgumentNotValidException.class)
    ResponseEntity<?> validation(MethodArgumentNotValidException e) {
        var fields = e.getBindingResult().getFieldErrors().stream()
            .map(f -> new ApiException.FieldIssue(f.getField(), f.getDefaultMessage())).toList();
        return api(new ApiException(400, "invalid_payload", "validation", "Invalid request", fields));
    }
    @ExceptionHandler(HttpMessageNotReadableException.class)
    ResponseEntity<?> malformed() { return api(new ApiException(400, "invalid_payload", "validation", "Invalid JSON")); }
    @ExceptionHandler(DataIntegrityViolationException.class)
    ResponseEntity<?> conflict() { return api(new ApiException(409, "invalid_payload", "email_taken", "Email already registered")); }
}
