use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

/// Quiescence gate for process-producing start paths.
///
/// A permit spans the whole provisional interval: before the child/provider is
/// created until it is registered or fully rolled back. Shutdown closes the
/// gate first, then waits under one deadline before draining registered owners.
#[derive(Debug, Default)]
pub struct StartGate {
    closed: AtomicBool,
    active: AtomicUsize,
}

#[derive(Debug)]
pub struct StartPermit {
    gate: Arc<StartGate>,
}

impl StartGate {
    pub fn begin(self: &Arc<Self>) -> Result<StartPermit, ()> {
        if self.closed.load(Ordering::SeqCst) {
            return Err(());
        }
        self.active.fetch_add(1, Ordering::SeqCst);
        if self.closed.load(Ordering::SeqCst) {
            self.active.fetch_sub(1, Ordering::SeqCst);
            return Err(());
        }
        Ok(StartPermit {
            gate: Arc::clone(self),
        })
    }

    pub fn close(&self) {
        self.closed.store(true, Ordering::SeqCst);
    }

    pub fn active(&self) -> usize {
        self.active.load(Ordering::SeqCst)
    }

    pub fn wait_until(&self, deadline: Instant) -> usize {
        loop {
            let active = self.active();
            if active == 0 || Instant::now() >= deadline {
                return active;
            }
            std::thread::sleep(Duration::from_millis(1));
        }
    }
}

impl Drop for StartPermit {
    fn drop(&mut self) {
        self.gate.active.fetch_sub(1, Ordering::SeqCst);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn close_rejects_new_starts_and_wait_is_bounded() {
        let gate = Arc::new(StartGate::default());
        let permit = gate.begin().unwrap();
        gate.close();
        assert!(gate.begin().is_err());
        assert_eq!(
            gate.wait_until(Instant::now() + Duration::from_millis(20)),
            1
        );
        drop(permit);
        assert_eq!(
            gate.wait_until(Instant::now() + Duration::from_millis(20)),
            0
        );
    }
}
