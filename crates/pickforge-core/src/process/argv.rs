/// Best-effort full argv for a live process.
#[cfg(target_os = "linux")]
pub(crate) fn process_argv(pid: u32) -> Option<Vec<String>> {
    let cmdline = std::fs::read(format!("/proc/{pid}/cmdline")).ok()?;
    Some(
        cmdline
            .split(|byte| *byte == 0)
            .filter(|arg| !arg.is_empty())
            .map(|arg| String::from_utf8_lossy(arg).into_owned())
            .collect(),
    )
}

#[cfg(target_os = "macos")]
pub(crate) fn process_argv(pid: u32) -> Option<Vec<String>> {
    let mut argmax: libc::c_int = 0;
    let mut argmax_len = std::mem::size_of::<libc::c_int>();
    let mut argmax_mib = [libc::CTL_KERN, libc::KERN_ARGMAX];
    let argmax_status = unsafe {
        libc::sysctl(
            argmax_mib.as_mut_ptr(),
            argmax_mib.len() as libc::c_uint,
            (&mut argmax as *mut libc::c_int).cast(),
            &mut argmax_len,
            std::ptr::null_mut(),
            0,
        )
    };
    if argmax_status != 0 || argmax <= std::mem::size_of::<libc::c_int>() as libc::c_int {
        return None;
    }

    let mut buffer = vec![0_u8; argmax as usize];
    let mut read_len = buffer.len();
    let mut args_mib = [libc::CTL_KERN, libc::KERN_PROCARGS2, pid as libc::c_int];
    let args_status = unsafe {
        libc::sysctl(
            args_mib.as_mut_ptr(),
            args_mib.len() as libc::c_uint,
            buffer.as_mut_ptr().cast(),
            &mut read_len,
            std::ptr::null_mut(),
            0,
        )
    };
    if args_status != 0 || read_len > buffer.len() {
        return None;
    }
    buffer.truncate(read_len);
    parse_kern_procargs2(&buffer)
}

#[cfg(target_os = "macos")]
fn parse_kern_procargs2(buffer: &[u8]) -> Option<Vec<String>> {
    let argc_bytes: [u8; std::mem::size_of::<libc::c_int>()] = buffer
        .get(..std::mem::size_of::<libc::c_int>())?
        .try_into()
        .ok()?;
    let argc = libc::c_int::from_ne_bytes(argc_bytes);
    if argc < 0 {
        return None;
    }

    let mut cursor = std::mem::size_of::<libc::c_int>();
    cursor += buffer.get(cursor..)?.iter().position(|byte| *byte == 0)? + 1;
    while buffer.get(cursor) == Some(&0) {
        cursor += 1;
    }

    let mut argv = Vec::with_capacity(argc as usize);
    for _ in 0..argc {
        let tail = buffer.get(cursor..)?;
        let end = tail.iter().position(|byte| *byte == 0)?;
        argv.push(String::from_utf8_lossy(&tail[..end]).into_owned());
        cursor += end + 1;
    }
    Some(argv)
}

#[cfg(all(unix, not(any(target_os = "linux", target_os = "macos"))))]
pub(crate) fn process_argv(_pid: u32) -> Option<Vec<String>> {
    None
}

#[cfg(windows)]
pub(crate) fn process_argv(_pid: u32) -> Option<Vec<String>> {
    None
}
