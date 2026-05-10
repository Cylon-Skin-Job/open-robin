/**
 * ApiKeysPanel — list of stored API keys plus inline add form.
 *
 * Renders from useSecretsStore. Never writes the secret value to the store —
 * the value field is component-local state only and is cleared after the
 * server's state broadcast confirms the round-trip.
 *
 * See SECRETS_MANAGER_SPEC.md §5c–§5e.
 */

import { useEffect, useRef, useState } from 'react';
import { useSecretsStore, type ApiKeyIndexEntry } from '../../../state/secretsStore';
import { setApiKey, deleteApiKey } from './api-keys-api';

const KEY_PATTERN = /^[A-Z][A-Z0-9_]*$/;
const MAX_DESCRIPTION_LENGTH = 150;
const NAME_HINT =
  'Names use UPPER_SNAKE_CASE: STRIPE_KEY_PROD, GITHUB_TOKEN. Letters, digits, underscores only — must start with a letter.';
const VALUE_HINT = 'Min 8 characters.';
const EMPTY_COPY =
  'No API keys stored yet. Add keys and tokens your scripts need to talk to outside services.';
const BACKEND_UNAVAILABLE_COPY =
  "Couldn't reach secrets storage. Try again, or restart Fusion Studio.";

interface Props {
  onClose: () => void;
}

export default function ApiKeysPanel({ onClose: _onClose }: Props) {
  const apiKeys = useSecretsStore(s => s.apiKeys);
  const lastError = useSecretsStore(s => s.lastError);
  const setApiKeysError = useSecretsStore(s => s.setApiKeysError);

  // Form state — value is component-local only and is never persisted.
  const [formOpen, setFormOpen] = useState(false);
  const [name, setName] = useState('');
  const [value, setValue] = useState('');
  const [description, setDescription] = useState('');
  const [expiresAtStr, setExpiresAtStr] = useState('');
  const [valueTouched, setValueTouched] = useState(false);

  const [pendingDeleteName, setPendingDeleteName] = useState<string | null>(null);
  const [duplicatePrompt, setDuplicatePrompt] = useState(false);
  const [submittedName, setSubmittedName] = useState<string | null>(null);
  const submittedUpdatedAt = useRef<number | null>(null);

  const nameValid = KEY_PATTERN.test(name);
  const valueValid = value.length >= 8;
  const descriptionTooLong = description.length > MAX_DESCRIPTION_LENGTH;
  const canSubmit = nameValid && valueValid && !descriptionTooLong;

  // After a submit, watch for the server broadcast to land. Once the row
  // exists with a refreshed updated_at, clear the form. Don't preemptively close.
  useEffect(() => {
    if (!submittedName) return;
    const entry = apiKeys.find(k => k.name === submittedName);
    if (!entry) return;
    const baseline = submittedUpdatedAt.current;
    if (baseline != null && entry.updated_at <= baseline) return;
    resetForm();
    setSubmittedName(null);
    submittedUpdatedAt.current = null;
  }, [apiKeys, submittedName]);

  function resetForm() {
    setName('');
    setValue('');
    setDescription('');
    setExpiresAtStr('');
    setValueTouched(false);
    setDuplicatePrompt(false);
    setFormOpen(false);
  }

  function clearBannerOnEdit() {
    if (lastError) setApiKeysError(null);
  }

  function handleSaveClick() {
    if (!canSubmit) return;
    const existing = apiKeys.find(k => k.name === name);
    if (existing && !duplicatePrompt) {
      setDuplicatePrompt(true);
      return;
    }
    sendSet(existing?.updated_at ?? null);
  }

  function sendSet(existingUpdatedAt: number | null) {
    submittedUpdatedAt.current = existingUpdatedAt;
    const payload: Parameters<typeof setApiKey>[0] = {
      name,
      value,
    };
    if (description.trim()) payload.description = description.trim();
    if (expiresAtStr) {
      const ts = Date.parse(expiresAtStr);
      if (!Number.isNaN(ts)) payload.expires_at = ts;
    }
    setApiKey(payload);
    setSubmittedName(name);
    setDuplicatePrompt(false);
  }

  function handleCancelForm() {
    resetForm();
    setApiKeysError(null);
  }

  function handleDeleteClick(entryName: string) {
    deleteApiKey(entryName);
    setPendingDeleteName(null);
  }

  const inlineFormError =
    lastError &&
    (lastError.code === 'INVALID_NAME' ||
      lastError.code === 'INVALID_VALUE' ||
      lastError.code === 'DUPLICATE')
      ? lastError
      : null;

  const bannerError =
    lastError && lastError.code === 'BACKEND_UNAVAILABLE' ? lastError : null;

  return (
    <div className="rv-secrets-panel">
      {bannerError && (
        <div className="rv-secrets-error-banner" role="alert">
          {BACKEND_UNAVAILABLE_COPY}
        </div>
      )}

      <div className="rv-secrets-panel-title">API Keys &amp; Tokens</div>

      {apiKeys.length === 0 && !formOpen && (
        <div className="rv-secrets-empty">{EMPTY_COPY}</div>
      )}

      {apiKeys.length > 0 && (
        <ul className="rv-secrets-key-list">
          {apiKeys.map(entry => (
            <KeyRow
              key={entry.name}
              entry={entry}
              pending={pendingDeleteName === entry.name}
              onAskDelete={() => setPendingDeleteName(entry.name)}
              onCancelDelete={() => setPendingDeleteName(null)}
              onConfirmDelete={() => handleDeleteClick(entry.name)}
            />
          ))}
        </ul>
      )}

      {!formOpen && (
        <button
          type="button"
          className="rv-secrets-add-btn"
          onClick={() => {
            setFormOpen(true);
            setApiKeysError(null);
          }}
        >
          + Add API key
        </button>
      )}

      {formOpen && (
        <div className="rv-secrets-form">
          {/* Name */}
          <label className="rv-secrets-form-label" htmlFor="rv-secrets-name">
            Name
          </label>
          <input
            id="rv-secrets-name"
            className="rv-secrets-form-input rv-secrets-form-input--mono"
            type="text"
            placeholder="GITHUB_TOKEN"
            value={name}
            spellCheck={false}
            autoComplete="off"
            onChange={e => {
              setName(e.target.value);
              clearBannerOnEdit();
            }}
          />
          {name.length > 0 && !nameValid && (
            <div className="rv-secrets-validation-err">{NAME_HINT}</div>
          )}
          {name.length > 0 && nameValid && (
            <div className="rv-secrets-validation-ok">
              <span className="material-symbols-outlined">check</span>
            </div>
          )}

          {/* Value */}
          <label className="rv-secrets-form-label" htmlFor="rv-secrets-value">
            Value
          </label>
          <input
            id="rv-secrets-value"
            className="rv-secrets-form-input rv-secrets-form-input--mono"
            type="password"
            value={value}
            spellCheck={false}
            autoComplete="new-password"
            onChange={e => {
              setValue(e.target.value);
              clearBannerOnEdit();
            }}
            onBlur={() => setValueTouched(true)}
          />
          {valueTouched && !valueValid && (
            <div className="rv-secrets-validation-err">{VALUE_HINT}</div>
          )}

          {/* Description */}
          <label className="rv-secrets-form-label" htmlFor="rv-secrets-desc">
            Description
          </label>
          <textarea
            id="rv-secrets-desc"
            className="rv-secrets-form-textarea"
            rows={3}
            maxLength={MAX_DESCRIPTION_LENGTH}
            placeholder="optional — what is this and when should AI reach for it"
            value={description}
            onChange={e => setDescription(e.target.value.slice(0, MAX_DESCRIPTION_LENGTH))}
          />
          <div
            className={
              descriptionTooLong
                ? 'rv-secrets-desc-counter rv-secrets-validation-err'
                : 'rv-secrets-desc-counter'
            }
          >
            {description.length} / {MAX_DESCRIPTION_LENGTH}
          </div>

          {/* Expires */}
          <label className="rv-secrets-form-label" htmlFor="rv-secrets-expires">
            Expires
          </label>
          <input
            id="rv-secrets-expires"
            className="rv-secrets-form-input"
            type="date"
            value={expiresAtStr}
            onChange={e => setExpiresAtStr(e.target.value)}
          />

          {duplicatePrompt && (
            <div className="rv-secrets-duplicate-prompt">
              <code>{name}</code> already exists. Update existing?
              <div className="rv-secrets-confirm-inline">
                <button
                  type="button"
                  className="rv-secrets-btn-secondary"
                  onClick={() => setDuplicatePrompt(false)}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="rv-secrets-btn-primary"
                  onClick={() => {
                    const existing = apiKeys.find(k => k.name === name);
                    sendSet(existing?.updated_at ?? null);
                  }}
                >
                  Update
                </button>
              </div>
            </div>
          )}

          {inlineFormError && !duplicatePrompt && (
            <div className="rv-secrets-validation-err">{inlineFormError.message}</div>
          )}

          {!duplicatePrompt && (
            <div className="rv-secrets-form-footer">
              <button
                type="button"
                className="rv-secrets-btn-secondary"
                onClick={handleCancelForm}
              >
                Cancel
              </button>
              <button
                type="button"
                className="rv-secrets-btn-primary"
                disabled={!canSubmit}
                onClick={handleSaveClick}
              >
                Save
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function KeyRow({
  entry,
  pending,
  onAskDelete,
  onCancelDelete,
  onConfirmDelete,
}: {
  entry: ApiKeyIndexEntry;
  pending: boolean;
  onAskDelete: () => void;
  onCancelDelete: () => void;
  onConfirmDelete: () => void;
}) {
  return (
    <li className="rv-secrets-key-row">
      <div className="rv-secrets-key-main">
        <span className="rv-secrets-key-name">{entry.name}</span>
        <span className="rv-secrets-key-fingerprint">{entry.fingerprint}</span>
      </div>
      <div className="rv-secrets-key-right">
        {pending ? (
          <div className="rv-secrets-confirm-inline">
            <span className="rv-secrets-confirm-text">
              Delete <code>{entry.name}</code>?
            </span>
            <button
              type="button"
              className="rv-secrets-btn-secondary"
              onClick={onCancelDelete}
            >
              Cancel
            </button>
            <button
              type="button"
              className="rv-secrets-btn-danger"
              onClick={onConfirmDelete}
            >
              Delete
            </button>
          </div>
        ) : (
          <button
            type="button"
            className="rv-secrets-key-delete"
            aria-label={`Delete ${entry.name}`}
            onClick={onAskDelete}
          >
            <span className="material-symbols-outlined">close</span>
          </button>
        )}
      </div>
      {!pending && (entry.description || entry.expires_at || entry.updated_at) && (
        <div className="rv-secrets-key-meta">
          {entry.description ? (
            <span title={entry.description}>{entry.description}</span>
          ) : null}
          {entry.expires_at ? (
            <span> · Expires {formatDate(entry.expires_at)}</span>
          ) : null}
          {entry.updated_at ? <span> · {relativeTime(entry.updated_at)}</span> : null}
        </div>
      )}
    </li>
  );
}

function formatDate(unix_ms: number): string {
  const d = new Date(unix_ms);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function relativeTime(unix_ms: number): string {
  const diff = Date.now() - unix_ms;
  if (diff < 0) return 'just now';
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (diff < minute) return 'just now';
  if (diff < hour) return `${Math.floor(diff / minute)}m ago`;
  if (diff < day) return `${Math.floor(diff / hour)}h ago`;
  return `${Math.floor(diff / day)}d ago`;
}
