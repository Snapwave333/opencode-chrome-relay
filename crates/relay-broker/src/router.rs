use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use tokio::sync::mpsc;

pub type ConnectionId = u64;

#[derive(Clone, Default)]
pub struct ResultRouter {
    next_id: Arc<AtomicU64>,
    connections: Arc<Mutex<HashMap<ConnectionId, mpsc::UnboundedSender<String>>>>,
    pending: Arc<Mutex<HashMap<String, ConnectionId>>>,
}

impl ResultRouter {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn register(&self) -> (ConnectionId, mpsc::UnboundedReceiver<String>) {
        let id = self.next_id.fetch_add(1, Ordering::Relaxed) + 1;
        let (tx, rx) = mpsc::unbounded_channel();
        self.connections.lock().unwrap().insert(id, tx);
        (id, rx)
    }

    pub fn unregister(&self, id: ConnectionId) {
        self.connections.lock().unwrap().remove(&id);
        self.pending.lock().unwrap().retain(|_, owner| *owner != id);
    }

    pub fn track(&self, idempotency_key: &str, owner: ConnectionId) {
        self.pending
            .lock()
            .unwrap()
            .insert(idempotency_key.to_string(), owner);
    }

    pub fn owner_of(&self, idempotency_key: &str) -> Option<ConnectionId> {
        self.pending.lock().unwrap().get(idempotency_key).copied()
    }

    pub fn pending_count(&self) -> usize {
        self.pending.lock().unwrap().len()
    }

    pub fn deliver_result(&self, idempotency_key: &str, frame: &str) -> bool {
        let owner = match self.pending.lock().unwrap().remove(idempotency_key) {
            Some(owner) => owner,
            None => return false,
        };
        match self.connections.lock().unwrap().get(&owner) {
            Some(tx) => tx.send(frame.to_string()).is_ok(),
            None => false,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn delivers_result_only_to_the_requesting_connection() {
        let router = ResultRouter::new();
        let (a, mut rx_a) = router.register();
        let (_b, mut rx_b) = router.register();

        router.track("run_a:1", a);
        assert!(router.deliver_result("run_a:1", "finished-a"));

        assert_eq!(rx_a.try_recv().unwrap(), "finished-a");
        assert!(rx_b.try_recv().is_err());
        assert_eq!(router.pending_count(), 0);
    }

    #[test]
    fn unknown_keys_are_not_delivered() {
        let router = ResultRouter::new();
        let (_a, mut rx_a) = router.register();
        assert!(!router.deliver_result("never-tracked", "frame"));
        assert!(rx_a.try_recv().is_err());
    }

    #[test]
    fn unregistering_drops_pending_ownership() {
        let router = ResultRouter::new();
        let (a, _rx_a) = router.register();
        let (b, _rx_b) = router.register();
        router.track("k1", a);
        router.track("k2", b);

        router.unregister(a);

        assert_eq!(router.owner_of("k1"), None);
        assert_eq!(router.owner_of("k2"), Some(b));
        assert!(!router.deliver_result("k1", "late"));
    }

    #[test]
    fn connection_ids_are_unique() {
        let router = ResultRouter::new();
        let ids: Vec<_> = (0..50).map(|_| router.register().0).collect();
        let mut sorted = ids.clone();
        sorted.sort();
        sorted.dedup();
        assert_eq!(sorted.len(), ids.len());
    }
}
