use std::sync::{Arc, Condvar, Mutex};

/// Quiescence gate for process-producing start paths.
///
/// A permit spans the whole provisional interval: before the child/provider is
/// created until it is registered or fully rolled back. Shutdown closes the
/// gate, cancels provisional owners, then waits for strict quiescence before it
/// drains registered owners and returns.
#[derive(Debug, Default)]
pub struct StartGate {
    state: Mutex<StartGateState>,
    quiescent: Condvar,
}

#[derive(Debug, Default)]
struct StartGateState {
    closed: bool,
    active: usize,
}

#[derive(Debug)]
pub struct StartPermit {
    gate: Arc<StartGate>,
}

impl StartGate {
    pub fn begin(self: &Arc<Self>) -> Result<StartPermit, ()> {
        let mut state = self.state.lock().expect("start gate poisoned");
        if state.closed {
            return Err(());
        }
        state.active += 1;
        Ok(StartPermit {
            gate: Arc::clone(self),
        })
    }

    pub fn close(&self) {
        self.state.lock().expect("start gate poisoned").closed = true;
    }

    pub fn active(&self) -> usize {
        self.state.lock().expect("start gate poisoned").active
    }

    pub fn wait(&self) {
        let mut state = self.state.lock().expect("start gate poisoned");
        while state.active != 0 {
            state = self
                .quiescent
                .wait(state)
                .expect("start gate poisoned while waiting");
        }
    }

    pub fn close_and_wait(&self) {
        let mut state = self.state.lock().expect("start gate poisoned");
        state.closed = true;
        while state.active != 0 {
            state = self
                .quiescent
                .wait(state)
                .expect("start gate poisoned while waiting");
        }
    }
}

impl Drop for StartPermit {
    fn drop(&mut self) {
        let mut state = self.gate.state.lock().expect("start gate poisoned");
        state.active -= 1;
        if state.active == 0 {
            self.gate.quiescent.notify_all();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn close_rejects_new_starts_and_waits_for_strict_quiescence() {
        let gate = Arc::new(StartGate::default());
        let permit = gate.begin().unwrap();
        gate.close();
        assert!(gate.begin().is_err());
        let waiter_gate = Arc::clone(&gate);
        let (done_tx, done_rx) = std::sync::mpsc::channel();
        let waiter = std::thread::spawn(move || {
            waiter_gate.wait();
            done_tx.send(()).unwrap();
        });
        assert!(done_rx
            .recv_timeout(std::time::Duration::from_millis(20))
            .is_err());
        drop(permit);
        done_rx
            .recv_timeout(std::time::Duration::from_secs(1))
            .unwrap();
        waiter.join().unwrap();
    }
}
