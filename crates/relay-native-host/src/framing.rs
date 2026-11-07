use byteorder::{ByteOrder, LittleEndian};
use std::io::{self, Read, Write};

pub fn read_native_message<R: Read>(mut reader: R) -> io::Result<Option<String>> {
    let mut len_buf = [0u8; 4];
    match reader.read_exact(&mut len_buf) {
        Ok(()) => {}
        Err(e) if e.kind() == io::ErrorKind::UnexpectedEof => return Ok(None),
        Err(e) => return Err(e),
    }

    let len = LittleEndian::read_u32(&len_buf) as usize;
    if len == 0 {
        return Ok(Some(String::new()));
    }
    // Limit to 10MB safety bound
    if len > 10 * 1024 * 1024 {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "Native message exceeds maximum 10MB bound",
        ));
    }

    let mut msg_buf = vec![0u8; len];
    reader.read_exact(&mut msg_buf)?;

    let s = String::from_utf8(msg_buf)
        .map_err(|e| io::Error::new(io::ErrorKind::InvalidData, format!("Invalid UTF-8: {}", e)))?;
    Ok(Some(s))
}

pub const MAX_TO_CHROME_BYTES: usize = 1024 * 1024;

pub fn write_native_message<W: Write>(mut writer: W, msg: &str) -> io::Result<()> {
    let bytes = msg.as_bytes();
    // Chrome disconnects a host that sends it a message over 1 MB
    if bytes.len() > MAX_TO_CHROME_BYTES {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            format!("Native message of {} bytes exceeds Chrome's 1 MB limit", bytes.len()),
        ));
    }
    // One write_all for header and body: two threads write to stdout, and a split write lets
    // another frame land between a length and its body
    let mut frame = Vec::with_capacity(4 + bytes.len());
    let mut len_buf = [0u8; 4];
    LittleEndian::write_u32(&mut len_buf, bytes.len() as u32);
    frame.extend_from_slice(&len_buf);
    frame.extend_from_slice(bytes);

    writer.write_all(&frame)?;
    writer.flush()?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_roundtrip_native_framing() {
        let original = r#"{"test":"hello world"}"#;
        let mut buffer = Vec::new();

        write_native_message(&mut buffer, original).unwrap();
        assert_eq!(buffer.len(), 4 + original.len());

        let mut cursor = std::io::Cursor::new(buffer);
        let read_back = read_native_message(&mut cursor).unwrap();
        assert_eq!(read_back, Some(original.to_string()));
    }

    #[test]
    fn test_eof_handling() {
        let empty: &[u8] = &[];
        let read_back = read_native_message(empty).unwrap();
        assert_eq!(read_back, None);
    }
}
