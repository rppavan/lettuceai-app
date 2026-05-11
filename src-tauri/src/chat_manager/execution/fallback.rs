use tauri::AppHandle;

use crate::chat_manager::storage::resolve_credential_for_model;
use crate::chat_manager::types::{Character, Model, ProviderCredential, Settings};
use crate::utils::{emit_toast, log_info, log_warn};

pub(crate) fn find_model_with_credential<'a>(
    settings: &'a Settings,
    model_id: &str,
) -> Option<(&'a Model, &'a ProviderCredential)> {
    let model = settings.models.iter().find(|m| m.id == model_id)?;
    let credential = resolve_credential_for_model(settings, model)?;
    Some((model, credential))
}

pub(crate) fn build_model_attempts<'a>(
    app: &AppHandle,
    settings: &'a Settings,
    character: &Character,
    primary_model: &'a Model,
    primary_credential: &'a ProviderCredential,
    log_scope: &str,
) -> Vec<(&'a Model, &'a ProviderCredential, bool)> {
    let explicit_fallback_candidate = character
        .fallback_model_id
        .as_ref()
        .filter(|fallback_id| *fallback_id != &primary_model.id)
        .and_then(|fallback_id| find_model_with_credential(settings, fallback_id));

    let app_default_fallback_candidate = settings
        .default_model_id
        .as_ref()
        .filter(|default_id| *default_id != &primary_model.id)
        .and_then(|default_id| find_model_with_credential(settings, default_id));

    let mut attempts: Vec<(&Model, &ProviderCredential, bool)> =
        vec![(primary_model, primary_credential, false)];
    if let Some((fallback_model, fallback_cred)) = explicit_fallback_candidate {
        attempts.push((fallback_model, fallback_cred, true));
    } else if character
        .fallback_model_id
        .as_ref()
        .is_some_and(|id| id != &primary_model.id)
    {
        log_warn(
            app,
            log_scope,
            format!(
                "configured character fallback model id {} could not be resolved",
                character.fallback_model_id.as_deref().unwrap_or("")
            ),
        );
        if let Some((fallback_model, fallback_cred)) = app_default_fallback_candidate {
            log_info(
                app,
                log_scope,
                format!(
                    "using app default model {} as fallback candidate",
                    fallback_model.name
                ),
            );
            attempts.push((fallback_model, fallback_cred, true));
        }
    }

    attempts
}

pub(crate) fn emit_fallback_retry_toast(app: &AppHandle, shown: &mut bool) {
    if *shown {
        return;
    }
    emit_toast(
        app,
        "warning",
        "Primary model failed",
        Some("Retrying with fallback model.".to_string()),
    );
    *shown = true;
}
