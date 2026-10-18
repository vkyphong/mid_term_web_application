package dev.pulsechat.common;

import java.util.List;

public class ApiException extends RuntimeException {
    public final int status;
    public final String code;
    public final String reason;
    public final List<FieldIssue> details;
    public record FieldIssue(String field, String message) {}
    public ApiException(int status, String code, String reason, String message) {
        this(status, code, reason, message, List.of());
    }
    public ApiException(int status, String code, String reason, String message, List<FieldIssue> details) {
        super(message); this.status = status; this.code = code; this.reason = reason; this.details = details;
    }
}
