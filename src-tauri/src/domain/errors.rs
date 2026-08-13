#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ViaError {
    InvalidRule {
        field: &'static str,
        reason: &'static str,
    },
    InvalidSession {
        field: &'static str,
        reason: &'static str,
    },
    NotFound(&'static str),
    Storage(String),
    InvalidImport(String),
    SecretStoreLocked,
    InvalidMasterPassword,
    InvalidRecoveryCode,
    InvalidSecret,
    HostTrustRequired {
        host: String,
        port: u16,
        algorithm: String,
        fingerprint: String,
    },
    HostKeyChanged {
        host: String,
        port: u16,
        expected_fingerprint: String,
        received_fingerprint: String,
    },
    PortConflict {
        port: u16,
    },
    Forwarding(String),
}

impl From<russh::Error> for ViaError {
    fn from(error: russh::Error) -> Self {
        Self::Forwarding(error.to_string())
    }
}
