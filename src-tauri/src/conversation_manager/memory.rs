use serde_json::Value;

pub(crate) fn event_advances_cursor(event: &Value) -> bool {
    !matches!(event.get("status").and_then(Value::as_str), Some("error"))
}

pub(crate) fn resolve_last_valid_window_end<F>(
    events: &[Value],
    mut resolve_message_index: F,
) -> Result<(usize, bool), String>
where
    F: FnMut(&str) -> Result<Option<usize>, String>,
{
    if events.is_empty() {
        return Ok((0, false));
    }
    for (reverse_index, event) in events
        .iter()
        .rev()
        .filter(|event| event_advances_cursor(event))
        .enumerate()
    {
        let end_id = event
            .get("windowMessageIds")
            .and_then(Value::as_array)
            .and_then(|ids| ids.last())
            .and_then(Value::as_str);
        let Some(end_id) = end_id else {
            continue;
        };
        if let Some(window_end) = resolve_message_index(end_id)? {
            return Ok((window_end, reverse_index != 0));
        }
    }
    Ok((0, true))
}

#[cfg(test)]
mod tests {
    use super::{event_advances_cursor, resolve_last_valid_window_end};
    use serde_json::json;

    #[test]
    fn errors_do_not_advance_but_legacy_events_do() {
        assert!(!event_advances_cursor(&json!({ "status": "error" })));
        assert!(event_advances_cursor(&json!({ "status": "complete" })));
        assert!(event_advances_cursor(&json!({ "windowEnd": 2 })));
    }

    #[test]
    fn newest_valid_anchor_wins_and_reports_rewind() {
        let events = vec![
            json!({ "windowMessageIds": ["first"], "status": "complete" }),
            json!({ "windowMessageIds": ["failed"], "status": "error" }),
            json!({ "windowMessageIds": ["deleted"], "status": "complete" }),
        ];
        let resolved =
            resolve_last_valid_window_end(&events, |id| Ok((id == "first").then_some(4))).unwrap();
        assert_eq!(resolved, (4, true));
    }
}
