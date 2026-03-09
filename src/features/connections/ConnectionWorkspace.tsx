import { CheckCircle2, CircleSlash2, Database, KeyRound, Plus, RefreshCcw, Shield, Trash2, Unplug, Wifi } from 'lucide-react';
import type { ReactNode } from 'react';
import type {
  AppError,
  ConnectionDraft,
  ConnectionSummary,
  ConnectionTestResult,
  DatabaseSessionSnapshot,
  SslMode,
} from '../../lib/contracts';

type DraftErrors = Partial<Record<keyof ConnectionDraft, string>>;

type PendingState = {
  loadingDetails: boolean;
  saving: boolean;
  testing: boolean;
  connecting: boolean;
  disconnecting: boolean;
  deleting: boolean;
};

type ConnectionsRailProps = {
  activeSession: DatabaseSessionSnapshot | null;
  connections: ConnectionSummary[];
  onCreateConnection: () => void;
  onSelectConnection: (connectionId: string) => void;
  selectedConnectionId: string | null;
};

type ConnectionEditorProps = {
  canConnect: boolean;
  canDelete: boolean;
  canDisconnect: boolean;
  canSave: boolean;
  canTest: boolean;
  draft: ConnectionDraft;
  draftErrors: DraftErrors;
  hasStoredSecret: boolean;
  isDirty: boolean;
  latestError: AppError | null;
  pending: PendingState;
  replacePassword: boolean;
  selectedConnectionId: string | null;
  onDelete: () => Promise<void>;
  onDisconnect: () => Promise<void>;
  onSave: () => Promise<void>;
  onTest: () => Promise<void>;
  onConnect: () => Promise<void>;
  onToggleReplacePassword: (enabled: boolean) => void;
  onUpdateDraft: <Key extends keyof ConnectionDraft>(key: Key, value: ConnectionDraft[Key]) => void;
};

type ConnectionResultsProps = {
  activeSession: DatabaseSessionSnapshot | null;
  latestTestResult: ConnectionTestResult | null;
};

const SSL_OPTIONS: { value: SslMode; label: string; caption: string }[] = [
  { value: 'disable', label: 'Disable', caption: 'Plain TCP only' },
  { value: 'prefer', label: 'Prefer', caption: 'Use TLS when available' },
  { value: 'require', label: 'Require', caption: 'Fail if TLS is unavailable' },
];

export function ConnectionsRail({
  activeSession,
  connections,
  onCreateConnection,
  onSelectConnection,
  selectedConnectionId,
}: ConnectionsRailProps) {
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-[var(--line-soft)] px-4 py-3">
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-[var(--ink-3)]">Saved targets</p>
          <h2 className="mt-1 font-display text-2xl text-[var(--ink-1)]">Connections</h2>
        </div>
        <button
          className="inline-flex items-center gap-2 border border-[var(--line-strong)] bg-[var(--accent-soft)] px-3 py-2 text-xs font-medium uppercase tracking-[0.16em] text-[var(--ink-1)] transition hover:-translate-y-0.5 hover:bg-[var(--accent-softer)]"
          data-testid="new-connection-button"
          onClick={onCreateConnection}
          type="button"
        >
          <Plus className="h-3.5 w-3.5" />
          New
        </button>
      </div>

      <div className="grid gap-3 p-4">
        {connections.length > 0 ? (
          connections.map((connection) => {
            const isActive = activeSession?.connectionId === connection.id;
            const isSelected = selectedConnectionId === connection.id;

            return (
              <button
                className={`grid gap-2 border px-3 py-3 text-left transition ${
                  isSelected
                    ? 'border-[var(--line-strong)] bg-[var(--surface-0)] shadow-[var(--shadow-soft)]'
                    : 'border-[var(--line-soft)] bg-[color-mix(in_oklch,_var(--surface-1)_88%,_white_12%)] hover:border-[var(--line-strong)]'
                }`}
                data-testid={`connection-row-${connection.id}`}
                key={connection.id}
                onClick={() => {
                  onSelectConnection(connection.id);
                }}
                type="button"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-medium text-[var(--ink-1)]">{connection.name}</p>
                    <p className="mt-1 text-xs uppercase tracking-[0.16em] text-[var(--ink-3)]">
                      {connection.host}:{connection.port}
                    </p>
                  </div>
                  {isActive ? (
                    <span className="inline-flex items-center gap-1 border border-[var(--line-strong)] bg-[var(--accent-soft)] px-2 py-1 text-[10px] uppercase tracking-[0.16em] text-[var(--ink-1)]">
                      <Wifi className="h-3 w-3" />
                      Active
                    </span>
                  ) : null}
                </div>
                <div className="flex items-center justify-between text-sm text-[var(--ink-2)]">
                  <span>{connection.database}</span>
                  <span>{connection.username}</span>
                </div>
                <div className="flex items-center justify-between text-xs text-[var(--ink-3)]">
                  <span>{connection.hasStoredSecret ? 'Secret stored' : 'No secret stored'}</span>
                  <span>{connection.lastTestedAt ? formatShortTime(connection.lastTestedAt) : 'Never tested'}</span>
                </div>
              </button>
            );
          })
        ) : (
          <div className="border border-dashed border-[var(--line-soft)] bg-[var(--surface-0)] p-4 text-sm text-[var(--ink-2)]">
            Start with a local or staging PostgreSQL profile. The layout stays fixed so later phases can attach schema
            and query tools without reshaping the shell.
          </div>
        )}
      </div>
    </div>
  );
}

export function ConnectionEditor({
  canConnect,
  canDelete,
  canDisconnect,
  canSave,
  canTest,
  draft,
  draftErrors,
  hasStoredSecret,
  isDirty,
  latestError,
  pending,
  replacePassword,
  selectedConnectionId,
  onDelete,
  onDisconnect,
  onSave,
  onTest,
  onConnect,
  onToggleReplacePassword,
  onUpdateDraft,
}: ConnectionEditorProps) {
  const isNewConnection = selectedConnectionId === null;

  return (
    <div className="grid h-full min-h-[300px] grid-rows-[auto_minmax(0,1fr)_auto] bg-[var(--surface-1)]">
      <div className="grid gap-4 border-b border-[var(--line-soft)] px-5 py-5 lg:grid-cols-[1.4fr_0.8fr]">
        <div>
          <p className="text-xs uppercase tracking-[0.24em] text-[var(--ink-3)]">PostgreSQL workspace</p>
          <h3 className="mt-2 font-display text-3xl text-[var(--ink-1)]">
            {isNewConnection ? 'Draft a new target' : draft.name || 'Edit selected connection'}
          </h3>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-[var(--ink-2)]">
            Save metadata separately from secrets, test drafts without persistence, and only connect from a saved
            profile.
          </p>
        </div>
        <div className="grid gap-3 border border-[var(--line-soft)] bg-[color-mix(in_oklch,_var(--surface-0)_90%,_white_10%)] p-4 text-sm text-[var(--ink-2)]">
          <div className="flex items-center justify-between">
            <span className="uppercase tracking-[0.16em] text-[var(--ink-3)]">Draft state</span>
            <span className={isDirty ? 'text-[var(--accent-strong)]' : 'text-[var(--ink-3)]'}>
              {isDirty ? 'Unsaved changes' : 'Synced'}
            </span>
          </div>
          <p>{selectedConnectionId ? 'Saved profile selected.' : 'Unsaved draft selected.'}</p>
          <p>{pending.loadingDetails ? 'Loading connection metadata.' : 'Metadata ready for editing.'}</p>
          {latestError ? <p className="text-[var(--danger-ink)]">{latestError.message}</p> : null}
        </div>
      </div>

      <div className="grid min-h-0 gap-5 overflow-auto px-5 py-5 lg:grid-cols-[1.2fr_0.8fr]">
        <section className="grid gap-4">
          <Field label="Connection name" error={draftErrors.name}>
            <input
              className={inputClassName(Boolean(draftErrors.name))}
              data-testid="connection-name-input"
              onChange={(event) => {
                onUpdateDraft('name', event.currentTarget.value);
              }}
              value={draft.name}
            />
          </Field>

          <div className="grid gap-4 md:grid-cols-[1.2fr_0.6fr]">
            <Field label="Host" error={draftErrors.host}>
              <input
                className={inputClassName(Boolean(draftErrors.host))}
                data-testid="connection-host-input"
                onChange={(event) => {
                  onUpdateDraft('host', event.currentTarget.value);
                }}
                value={draft.host}
              />
            </Field>
            <Field label="Port" error={draftErrors.port}>
              <input
                className={inputClassName(Boolean(draftErrors.port))}
                onChange={(event) => {
                  onUpdateDraft('port', Number(event.currentTarget.value) || 0);
                }}
                type="number"
                value={draft.port}
              />
            </Field>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Database" error={draftErrors.database}>
              <input
                className={inputClassName(Boolean(draftErrors.database))}
                data-testid="connection-database-input"
                onChange={(event) => {
                  onUpdateDraft('database', event.currentTarget.value);
                }}
                value={draft.database}
              />
            </Field>
            <Field label="Username" error={draftErrors.username}>
              <input
                className={inputClassName(Boolean(draftErrors.username))}
                data-testid="connection-username-input"
                onChange={(event) => {
                  onUpdateDraft('username', event.currentTarget.value);
                }}
                value={draft.username}
              />
            </Field>
          </div>

          <section className="grid gap-3 border border-[var(--line-soft)] bg-[color-mix(in_oklch,_var(--surface-0)_90%,_white_10%)] p-4">
            <div className="flex items-center gap-2">
              <Shield className="h-4 w-4 text-[var(--accent-strong)]" />
              <div>
                <p className="text-xs uppercase tracking-[0.18em] text-[var(--ink-3)]">Transport</p>
                <h4 className="text-lg font-medium text-[var(--ink-1)]">SSL mode</h4>
              </div>
            </div>
            <div className="grid gap-2 md:grid-cols-3">
              {SSL_OPTIONS.map((option) => (
                <button
                  className={`grid gap-1 border px-3 py-3 text-left transition ${
                    draft.sslMode === option.value
                      ? 'border-[var(--line-strong)] bg-[var(--accent-soft)] text-[var(--ink-1)]'
                      : 'border-[var(--line-soft)] bg-[var(--surface-1)] text-[var(--ink-2)] hover:border-[var(--line-strong)]'
                  }`}
                  key={option.value}
                  onClick={() => {
                    onUpdateDraft('sslMode', option.value);
                  }}
                  type="button"
                >
                  <span className="text-sm font-medium">{option.label}</span>
                  <span className="text-xs leading-5 text-[var(--ink-3)]">{option.caption}</span>
                </button>
              ))}
            </div>
          </section>
        </section>

        <section className="grid gap-4">
          <section className="grid gap-4 border border-[var(--line-soft)] bg-[var(--surface-0)] p-4">
            <div className="flex items-center gap-2">
              <KeyRound className="h-4 w-4 text-[var(--accent-strong)]" />
              <div>
                <p className="text-xs uppercase tracking-[0.18em] text-[var(--ink-3)]">Security</p>
                <h4 className="text-lg font-medium text-[var(--ink-1)]">Stored secret</h4>
              </div>
            </div>
            {hasStoredSecret && !replacePassword ? (
              <div className="grid gap-3 border border-[var(--line-soft)] bg-[color-mix(in_oklch,_var(--surface-1)_90%,_white_10%)] p-4 text-sm text-[var(--ink-2)]">
                <p>Credentials are already stored securely for this profile.</p>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-xs uppercase tracking-[0.16em] text-[var(--ink-3)]">No plaintext shown</span>
                  <button
                    className="inline-flex items-center gap-2 border border-[var(--line-soft)] px-3 py-2 text-xs font-medium uppercase tracking-[0.16em] text-[var(--ink-2)] transition hover:border-[var(--line-strong)] hover:text-[var(--ink-1)]"
                    onClick={() => {
                      onToggleReplacePassword(true);
                    }}
                    type="button"
                  >
                    Replace password
                  </button>
                </div>
              </div>
            ) : (
              <Field
                label={hasStoredSecret ? 'Replacement password' : 'Password'}
                error={replacePassword && !draft.password ? 'Enter a replacement password or cancel the change.' : undefined}
              >
                <div className="grid gap-3">
                  <input
                    className={inputClassName(false)}
                    data-testid="connection-password-input"
                    onChange={(event) => {
                      onUpdateDraft('password', event.currentTarget.value);
                    }}
                    placeholder={hasStoredSecret ? 'Set a new secret' : 'Stored only in the system keychain'}
                    type="password"
                    value={draft.password ?? ''}
                  />
                  {hasStoredSecret ? (
                    <button
                      className="inline-flex items-center gap-2 text-xs font-medium uppercase tracking-[0.16em] text-[var(--ink-3)] transition hover:text-[var(--ink-1)]"
                      onClick={() => {
                        onUpdateDraft('password', null);
                        onToggleReplacePassword(false);
                      }}
                      type="button"
                    >
                      <CircleSlash2 className="h-3.5 w-3.5" />
                      Keep stored secret
                    </button>
                  ) : null}
                </div>
              </Field>
            )}
          </section>

          <section className="grid gap-3 border border-[var(--line-soft)] bg-[color-mix(in_oklch,_var(--surface-0)_92%,_white_8%)] p-4 text-sm text-[var(--ink-2)]">
            <div className="flex items-center gap-2">
              <Database className="h-4 w-4 text-[var(--accent-strong)]" />
              <p className="font-medium text-[var(--ink-1)]">Operator notes</p>
            </div>
            <p>Testing can use an unsaved draft. Connecting requires a saved profile with no unsaved metadata.</p>
            <p>{selectedConnectionId ? 'This profile can reconnect later from SQLite metadata.' : 'This draft is still local to the form.'}</p>
          </section>
        </section>
      </div>

      <div className="flex flex-wrap items-center gap-3 border-t border-[var(--line-soft)] bg-[var(--surface-0)] px-5 py-4">
        <ActionButton dataTestId="test-connection-button" disabled={!canTest} icon={RefreshCcw} onClick={onTest}>
          {pending.testing ? 'Testing…' : 'Test'}
        </ActionButton>
        <ActionButton dataTestId="save-connection-button" disabled={!canSave} icon={CheckCircle2} onClick={onSave}>
          {pending.saving ? 'Saving…' : 'Save'}
        </ActionButton>
        <ActionButton dataTestId="connect-connection-button" disabled={!canConnect} icon={Wifi} onClick={onConnect}>
          {pending.connecting ? 'Connecting…' : 'Connect'}
        </ActionButton>
        <ActionButton dataTestId="disconnect-connection-button" disabled={!canDisconnect} icon={Unplug} onClick={onDisconnect}>
          {pending.disconnecting ? 'Disconnecting…' : 'Disconnect'}
        </ActionButton>
        <button
          className="ml-auto inline-flex items-center gap-2 border border-[var(--line-soft)] px-3 py-2 text-xs font-medium uppercase tracking-[0.16em] text-[var(--danger-ink)] transition hover:border-[var(--danger-ink)] disabled:cursor-not-allowed disabled:opacity-45"
          data-testid="delete-connection-button"
          disabled={!canDelete}
          onClick={() => {
            void onDelete();
          }}
          type="button"
        >
          <Trash2 className="h-3.5 w-3.5" />
          {pending.deleting ? 'Deleting…' : 'Delete'}
        </button>
      </div>
    </div>
  );
}

export function ConnectionResults({ activeSession, latestTestResult }: ConnectionResultsProps) {
  return (
    <div className="grid gap-4 p-4 xl:grid-cols-[320px_minmax(0,1fr)]">
      <section className="grid gap-4">
        <article className="border border-[var(--line-soft)] bg-[var(--surface-0)] p-4">
          <p className="text-xs uppercase tracking-[0.18em] text-[var(--ink-3)]">Active session</p>
          {activeSession ? (
            <div className="mt-3 grid gap-2 text-sm text-[var(--ink-2)]">
              <p className="font-medium text-[var(--ink-1)]">{activeSession.name}</p>
              <p>
                {activeSession.host}:{activeSession.port}
              </p>
              <p>
                {activeSession.database} / {activeSession.username}
              </p>
              <p>SSL: {activeSession.sslInUse ? 'enabled' : 'disabled'}</p>
            </div>
          ) : (
            <p className="mt-3 text-sm text-[var(--ink-2)]">No saved connection is currently active.</p>
          )}
        </article>

        <article className="border border-[var(--line-soft)] bg-[var(--surface-0)] p-4">
          <p className="text-xs uppercase tracking-[0.18em] text-[var(--ink-3)]">Latest connection test</p>
          {latestTestResult ? (
            <div className="mt-3 grid gap-2 text-sm text-[var(--ink-2)]">
              <p className="font-medium text-[var(--ink-1)]">{latestTestResult.summaryMessage}</p>
              <p>Status: {latestTestResult.status}</p>
              <p>Round trip: {latestTestResult.roundTripMs ?? 'n/a'} ms</p>
              <p>SSL: {latestTestResult.sslInUse === null ? 'unknown' : latestTestResult.sslInUse ? 'enabled' : 'disabled'}</p>
            </div>
          ) : (
            <p className="mt-3 text-sm text-[var(--ink-2)]">Run a test to capture server identity and transport details.</p>
          )}
        </article>
      </section>

      <section className="border border-[var(--line-soft)] bg-[color-mix(in_oklch,_var(--surface-0)_92%,_white_8%)] p-4">
        <div className="flex items-center justify-between">
          <p className="text-xs uppercase tracking-[0.18em] text-[var(--ink-3)]">Result details</p>
          <span className="text-xs text-[var(--ink-3)]">Phase 2 status rail</span>
        </div>
        {latestTestResult ? (
          <dl className="mt-4 grid gap-3 text-sm text-[var(--ink-2)] md:grid-cols-2">
            <Metric label="Server version" value={latestTestResult.serverVersion ?? 'Unavailable'} />
            <Metric label="Current database" value={latestTestResult.currentDatabase ?? 'Unavailable'} />
            <Metric label="Current user" value={latestTestResult.currentUser ?? 'Unavailable'} />
            <Metric label="Tested at" value={formatLongTime(latestTestResult.testedAt)} />
          </dl>
        ) : (
          <div className="mt-4 border border-dashed border-[var(--line-soft)] p-4 text-sm text-[var(--ink-2)]">
            This panel becomes the first status surface for connection diagnostics before query results arrive in later
            phases.
          </div>
        )}
      </section>
    </div>
  );
}

function Field({
  children,
  error,
  label,
}: {
  children: ReactNode;
  error?: string;
  label: string;
}) {
  return (
    <label className="grid gap-2 text-sm text-[var(--ink-2)]">
      <span className="text-xs uppercase tracking-[0.16em] text-[var(--ink-3)]">{label}</span>
      {children}
      {error ? <span className="text-xs text-[var(--danger-ink)]">{error}</span> : null}
    </label>
  );
}

function ActionButton({
  children,
  dataTestId,
  disabled,
  icon: Icon,
  onClick,
}: {
  children: string;
  dataTestId: string;
  disabled: boolean;
  icon: typeof RefreshCcw;
  onClick: () => Promise<void>;
}) {
  return (
    <button
      className="inline-flex items-center gap-2 border border-[var(--line-strong)] bg-[var(--accent-soft)] px-3 py-2 text-xs font-medium uppercase tracking-[0.16em] text-[var(--ink-1)] transition hover:-translate-y-0.5 hover:bg-[var(--accent-softer)] disabled:cursor-not-allowed disabled:opacity-45"
      data-testid={dataTestId}
      disabled={disabled}
      onClick={() => {
        void onClick();
      }}
      type="button"
    >
      <Icon className="h-3.5 w-3.5" />
      {children}
    </button>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-[0.16em] text-[var(--ink-3)]">{label}</dt>
      <dd className="mt-1 text-[var(--ink-1)]">{value}</dd>
    </div>
  );
}

function inputClassName(hasError: boolean) {
  return `w-full border bg-[var(--surface-1)] px-3 py-2.5 text-sm text-[var(--ink-1)] outline-none transition focus:border-[var(--line-strong)] ${
    hasError ? 'border-[var(--danger-ink)]' : 'border-[var(--line-soft)]'
  }`;
}

function formatShortTime(value: string) {
  return new Date(value).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  });
}

function formatLongTime(value: string) {
  return new Date(value).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}
