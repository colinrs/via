use std::path::PathBuf;

use rusqlite::{Connection, OptionalExtension, params};

use crate::ViaError;

pub struct HostTrustStore {
    path: PathBuf,
}

impl HostTrustStore {
    pub fn new(path: PathBuf) -> Self {
        Self { path }
    }

    pub fn verify_or_request(
        &self,
        host: &str,
        port: u16,
        algorithm: &str,
        fingerprint: &str,
    ) -> Result<(), ViaError> {
        let host = normalize_host(host);
        let connection = self.connection()?;
        let existing = connection
            .query_row(
                "SELECT algorithm, fingerprint FROM ssh_host_trust WHERE host = ?1 AND port = ?2",
                params![host, port],
                |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)),
            )
            .optional()
            .map_err(database_error)?;

        match existing {
            None => Err(ViaError::HostTrustRequired {
                host,
                port,
                algorithm: algorithm.into(),
                fingerprint: fingerprint.into(),
            }),
            Some((trusted_algorithm, trusted_fingerprint))
                if trusted_algorithm == algorithm && trusted_fingerprint == fingerprint =>
            {
                Ok(())
            }
            Some((_, trusted_fingerprint)) => Err(ViaError::HostKeyChanged {
                host,
                port,
                expected_fingerprint: trusted_fingerprint,
                received_fingerprint: fingerprint.into(),
            }),
        }
    }

    pub fn approve(
        &self,
        host: &str,
        port: u16,
        algorithm: &str,
        fingerprint: &str,
    ) -> Result<(), ViaError> {
        let connection = self.connection()?;
        connection
            .execute(
                "INSERT INTO ssh_host_trust (host, port, algorithm, fingerprint) VALUES (?1, ?2, ?3, ?4)
                 ON CONFLICT(host, port) DO UPDATE SET algorithm = excluded.algorithm, fingerprint = excluded.fingerprint",
                params![normalize_host(host), port, algorithm, fingerprint],
            )
            .map_err(database_error)?;
        Ok(())
    }

    fn connection(&self) -> Result<Connection, ViaError> {
        if let Some(parent) = self.path.parent() {
            std::fs::create_dir_all(parent).map_err(storage_error)?;
        }
        let connection = Connection::open(&self.path).map_err(database_error)?;
        connection
            .execute_batch(
                "CREATE TABLE IF NOT EXISTS ssh_host_trust (
                    host TEXT NOT NULL,
                    port INTEGER NOT NULL,
                    algorithm TEXT NOT NULL,
                    fingerprint TEXT NOT NULL,
                    PRIMARY KEY(host, port)
                );",
            )
            .map_err(database_error)?;
        Ok(connection)
    }
}

fn normalize_host(host: &str) -> String {
    host.trim().trim_end_matches('.').to_ascii_lowercase()
}

fn database_error(error: rusqlite::Error) -> ViaError {
    ViaError::Storage(error.to_string())
}

fn storage_error(error: std::io::Error) -> ViaError {
    ViaError::Storage(error.to_string())
}
