package dev.pulsechat.upload;

import dev.pulsechat.chat.ChatService;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.nio.ByteBuffer;
import java.nio.charset.CharacterCodingException;
import java.nio.charset.CodingErrorAction;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.HashSet;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.zip.ZipInputStream;
import javax.imageio.ImageIO;
import javax.xml.parsers.DocumentBuilderFactory;

/** Content-derived MIME types. Browser-supplied Content-Type is never trusted. */
final class UploadTypes {
    private UploadTypes() {}
    private static final Map<String, String> OFFICE_PART = Map.of(
        "docx", "word/document.xml", "xlsx", "xl/workbook.xml", "pptx", "ppt/presentation.xml");
    private static final Map<String, String> OFFICE_MIME = Map.of(
        "docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "pptx", "application/vnd.openxmlformats-officedocument.presentationml.presentation");
    private static final Map<String, String> OFFICE_MAIN = Map.of(
        "docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml",
        "xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml",
        "pptx", "application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml");

    static String detect(String filename, byte[] bytes) {
        String extension = filename.substring(filename.lastIndexOf('.') + 1).toLowerCase(Locale.ROOT);
        return switch (extension) {
            case "png", "jpg", "jpeg" -> image(extension, bytes);
            case "pdf" -> {
                if (!starts(bytes, new byte[]{37, 80, 68, 70, 45})) throw invalid("Invalid PDF signature");
                yield "application/pdf";
            }
            case "txt", "csv" -> {
                text(bytes);
                yield extension.equals("txt") ? "text/plain" : "text/csv";
            }
            case "zip", "docx", "xlsx", "pptx" -> archive(extension, bytes);
            default -> throw invalid("Supported files: PNG, JPEG, PDF, TXT, CSV, DOCX, XLSX, PPTX and ZIP");
        };
    }
    private static String image(String extension, byte[] bytes) {
        boolean png = extension.equals("png");
        byte[] magic = png ? new byte[]{(byte)137,80,78,71,13,10,26,10} : new byte[]{(byte)255,(byte)216,(byte)255};
        if (!starts(bytes, magic)) throw invalid("Image signature does not match filename");
        try (var input = ImageIO.createImageInputStream(new ByteArrayInputStream(bytes))) {
            var readers = ImageIO.getImageReaders(input);
            if (!readers.hasNext()) throw invalid("Invalid image");
            var reader = readers.next();
            try {
                reader.setInput(input);
                if ((long)reader.getWidth(0) * reader.getHeight(0) > 25_000_000) throw invalid("Image exceeds 25 megapixels");
                if (reader.read(0) == null) throw invalid("Invalid image");
            } finally { reader.dispose(); }
        } catch (IOException e) { throw invalid("Invalid image"); }
        return png ? "image/png" : "image/jpeg";
    }
    private static void text(byte[] bytes) {
        try {
            String value = StandardCharsets.UTF_8.newDecoder().onMalformedInput(CodingErrorAction.REPORT)
                .onUnmappableCharacter(CodingErrorAction.REPORT).decode(ByteBuffer.wrap(bytes)).toString();
            if (value.codePoints().anyMatch(c -> c < 32 && c != '\t' && c != '\n' && c != '\r')) throw invalid("Text files must contain UTF-8 text without binary controls");
        } catch (CharacterCodingException e) { throw invalid("Text files must use UTF-8 encoding"); }
    }
    private static String archive(String extension, byte[] bytes) {
        if (!starts(bytes, new byte[]{80,75,3,4})) throw invalid("A non-empty ZIP archive is required");
        Set<String> entries = new HashSet<>();
        Map<String, byte[]> xml = new HashMap<>();
        long expanded = 0;
        try (var zip = new ZipInputStream(new ByteArrayInputStream(bytes))) {
            java.util.zip.ZipEntry entry;
            byte[] buffer = new byte[8192];
            while ((entry = zip.getNextEntry()) != null) {
                String name = entry.getName();
                if (entries.size() >= 1000 || !entries.add(name) || name.startsWith("/") || name.contains("\\") || name.contains(":") ||
                        java.util.Arrays.asList(name.split("/")).contains("..")) throw invalid("Invalid archive entry or too many entries");
                if (!extension.equals("zip") && (name.toLowerCase(Locale.ROOT).contains("vbaproject") || name.toLowerCase(Locale.ROOT).contains("activex/")))
                    throw invalid("Macro and ActiveX Office documents are not supported");
                boolean collect = name.equals("[Content_Types].xml") || name.equals(OFFICE_PART.get(extension));
                var output = collect ? new ByteArrayOutputStream() : null;
                int size;
                while ((size = zip.read(buffer)) != -1) {
                    expanded += size;
                    if (expanded > 25L * 1024 * 1024) throw invalid("Archive expands beyond 25 MiB");
                    if (collect) {
                        if (output.size() + size > 2 * 1024 * 1024) throw invalid("Office XML part exceeds 2 MiB");
                        output.write(buffer, 0, size);
                    }
                }
                if (collect) xml.put(name, output.toByteArray());
            }
        } catch (IOException | IllegalArgumentException e) { throw invalid("Invalid or encrypted ZIP archive"); }
        if (entries.isEmpty()) throw invalid("A non-empty ZIP archive is required");
        requireDirectory(bytes, entries.size());
        if (extension.equals("zip")) return "application/zip";
        String main = OFFICE_PART.get(extension);
        if (!xml.containsKey("[Content_Types].xml") || !xml.containsKey(main)) throw invalid("Office document structure does not match filename");
        try {
            var factory = DocumentBuilderFactory.newInstance();
            factory.setNamespaceAware(true);
            factory.setFeature("http://apache.org/xml/features/disallow-doctype-decl", true);
            factory.setFeature("http://xml.org/sax/features/external-general-entities", false);
            factory.setFeature("http://xml.org/sax/features/external-parameter-entities", false);
            factory.setAttribute(javax.xml.XMLConstants.ACCESS_EXTERNAL_DTD, "");
            factory.setAttribute(javax.xml.XMLConstants.ACCESS_EXTERNAL_SCHEMA, "");
            var parser = factory.newDocumentBuilder();
            // Throw on invalid XML without printing user-supplied parser diagnostics.
            parser.setErrorHandler(new org.xml.sax.helpers.DefaultHandler() {
                @Override public void error(org.xml.sax.SAXParseException e) throws org.xml.sax.SAXException { throw e; }
                @Override public void fatalError(org.xml.sax.SAXParseException e) throws org.xml.sax.SAXException { throw e; }
            });
            var types = parser.parse(new ByteArrayInputStream(xml.get("[Content_Types].xml")));
            var overrides = types.getElementsByTagNameNS("http://schemas.openxmlformats.org/package/2006/content-types", "Override");
            boolean found = false;
            for (int i = 0; i < overrides.getLength(); i++) {
                var node = (org.w3c.dom.Element)overrides.item(i);
                if (node.getAttribute("ContentType").toLowerCase(Locale.ROOT).contains("macroenabled")) throw invalid("Macro documents are not supported");
                if (node.getAttribute("PartName").equals("/" + main) && node.getAttribute("ContentType").equals(OFFICE_MAIN.get(extension))) found = true;
            }
            if (!found) throw invalid("Office document content type does not match filename");
            parser.parse(new ByteArrayInputStream(xml.get(main)));
        } catch (dev.pulsechat.common.ApiException e) { throw e; }
        catch (Exception e) { throw invalid("Invalid Office XML"); }
        return OFFICE_MIME.get(extension);
    }
    private static boolean starts(byte[] bytes, byte[] prefix) {
        if (bytes.length < prefix.length) return false;
        for (int i = 0; i < prefix.length; i++) if (bytes[i] != prefix[i]) return false;
        return true;
    }
    private static void requireDirectory(byte[] bytes, int count) {
        var data = ByteBuffer.wrap(bytes).order(java.nio.ByteOrder.LITTLE_ENDIAN);
        for (int i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
            if (data.getInt(i) != 0x06054b50 || i + 22 + Short.toUnsignedInt(data.getShort(i + 20)) != bytes.length) continue;
            long size = Integer.toUnsignedLong(data.getInt(i + 12)), offset = Integer.toUnsignedLong(data.getInt(i + 16));
            if (data.getShort(i + 4) != 0 || data.getShort(i + 6) != 0 || Short.toUnsignedInt(data.getShort(i + 8)) != count ||
                Short.toUnsignedInt(data.getShort(i + 10)) != count || offset + size != i || size < 46 || data.getInt((int)offset) != 0x02014b50)
                throw invalid("Invalid ZIP directory");
            return;
        }
        throw invalid("Incomplete ZIP archive");
    }
    private static dev.pulsechat.common.ApiException invalid(String message) { return ChatService.field("file", message); }
}
