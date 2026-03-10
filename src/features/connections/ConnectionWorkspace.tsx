import { CheckCircle2, CircleSlash2, Database, Edit3, KeyRound, Plus, RefreshCcw, Shield, Trash2, Unplug, Wifi, Zap } from 'lucide-react';
import type { ReactNode } from 'react';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { ScrollArea } from '../../components/ui/scroll-area';
import { Separator } from '../../components/ui/separator';
import { cn } from '../../lib/utils';
import type {
  AppError,
  ConnectionDraft,
  ConnectionSummary,
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
  canConnect: boolean;
  canDisconnect: boolean;
  connections: ConnectionSummary[];
  onConnectSelected: () => Promise<void>;
  onCreateConnection: () => void;
  onDisconnectSelected: () => Promise<void>;
  onEditSelected: () => void;
  onSelectConnection: (connectionId: string) => void;
  pending: PendingState;
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

const SSL_OPTIONS: { value: SslMode; label: string; caption: string }[] = [
  { value: 'disable', label: 'Disable', caption: 'Plain TCP only' },
  { value: 'prefer', label: 'Prefer', caption: 'Use TLS when available' },
  { value: 'require', label: 'Require', caption: 'Fail if TLS is unavailable' },
  { value: 'insecure', label: 'Insecure', caption: 'Skip certificate validation' },
];

export function ConnectionsRail({
  activeSession,
  canConnect,
  canDisconnect,
  connections,
  onConnectSelected,
  onCreateConnection,
  onDisconnectSelected,
  onEditSelected,
  onSelectConnection,
  pending,
  selectedConnectionId,
}: ConnectionsRailProps) {
  return (
    <section className="grid min-h-0 grid-rows-[auto_auto_minmax(0,1fr)]">
      <div className="flex items-center justify-between px-4 pb-3 pt-4">
        <div>
          <p className="text-[11px] uppercase tracking-[0.22em] text-[var(--text-muted)]">Connections</p>
          <h2 className="mt-1 text-lg font-semibold tracking-[0.01em] text-[var(--text-primary)]">Workspace graph</h2>
        </div>
        <Button
          className="shrink-0"
          data-testid="new-connection-button"
          onClick={onCreateConnection}
          size="sm"
          type="button"
        >
          <Plus className="h-3.5 w-3.5" />
          New
        </Button>
      </div>

      <div className="grid gap-2 px-4 pb-4">
        <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-panel)] p-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-xs font-medium text-[var(--text-primary)]">Selected target</p>
              <p className="mt-1 text-xs text-[var(--text-muted)]">
                {connections.find((connection) => connection.id === selectedConnectionId)?.name ?? 'None selected'}
              </p>
            </div>
            {activeSession ? <Badge variant="success">Live</Badge> : <Badge variant="warning">Idle</Badge>}
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button onClick={onEditSelected} size="sm" type="button" variant="secondary">
              <Edit3 className="h-3.5 w-3.5" />
              Edit
            </Button>
            <Button
              disabled={!canConnect}
              onClick={() => {
                void onConnectSelected();
              }}
              size="sm"
              type="button"
              variant="ghost"
            >
              <Wifi className="h-3.5 w-3.5" />
              {pending.connecting ? 'Connecting…' : 'Connect'}
            </Button>
            <Button
              disabled={!canDisconnect}
              onClick={() => {
                void onDisconnectSelected();
              }}
              size="sm"
              type="button"
              variant="ghost"
            >
              <Unplug className="h-3.5 w-3.5" />
              {pending.disconnecting ? 'Disconnecting…' : 'Disconnect'}
            </Button>
          </div>
        </div>
      </div>

      <ScrollArea className="min-h-0 px-2 pb-3">
        <div className="grid gap-1 px-2">
          {connections.length > 0 ? (
            connections.map((connection) => {
              const isActive = activeSession?.connectionId === connection.id;
              const isSelected = selectedConnectionId === connection.id;

              return (
                <button
                  className={cn(
                    'group grid gap-2 rounded-xl border px-3 py-3 text-left transition',
                    isSelected
                      ? 'border-[var(--border-accent)] bg-[var(--surface-highlight)] shadow-[var(--shadow-elevated)]'
                      : 'border-transparent bg-transparent hover:border-[var(--border-subtle)] hover:bg-[var(--surface-panel)]',
                  )}
                  data-testid={`connection-row-${connection.id}`}
                  key={connection.id}
                  onClick={() => {
                    onSelectConnection(connection.id);
                  }}
                  type="button"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-[var(--text-primary)]">{connection.name}</p>
                      <p className="mt-1 truncate text-xs text-[var(--text-muted)]">
                        {connection.engine} • {connection.host}:{connection.port}
                      </p>
                    </div>
                    {isActive ? <Badge variant="success">Active</Badge> : null}
                  </div>
                  <div className="flex items-center justify-between text-xs text-[var(--text-secondary)]">
                    <span className="truncate">{connection.database}</span>
                    <span className="truncate">{connection.username}</span>
                  </div>
                </button>
              );
            })
          ) : (
            <div className="rounded-xl border border-dashed border-[var(--border-subtle)] bg-[var(--surface-panel)] p-4 text-sm text-[var(--text-secondary)]">
              Create a local, staging, or production profile to start browsing schema and running queries.
            </div>
          )}
        </div>
      </ScrollArea>
    </section>
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
    <div className="grid max-h-[calc(100vh-2rem)] grid-rows-[auto_minmax(0,1fr)_auto]" data-testid="connection-dialog">
      <div className="px-6 pt-6">
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_260px]">
          <div>
            <p className="text-[11px] uppercase tracking-[0.24em] text-[var(--text-muted)]">Connection profile</p>
            <h2 className="mt-2 text-2xl font-semibold text-[var(--text-primary)]">
              {isNewConnection ? 'New connection' : draft.name || 'Edit connection'}
            </h2>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--text-secondary)]">
              Keep the shell clear by editing network, security, and transport details here. Drafts can be tested
              before they are saved.
            </p>
          </div>
          <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--surface-panel)] p-4">
            <div className="flex items-center justify-between">
              <span className="text-[11px] uppercase tracking-[0.18em] text-[var(--text-muted)]">Draft state</span>
              {isDirty ? <Badge variant="accent">Unsaved</Badge> : <Badge>Synced</Badge>}
            </div>
            <div className="mt-3 grid gap-2 text-sm text-[var(--text-secondary)]">
              <p>{selectedConnectionId ? 'Saved profile selected.' : 'Unsaved draft selected.'}</p>
              <p>{pending.loadingDetails ? 'Loading saved metadata.' : 'Ready for edits and testing.'}</p>
              {latestError ? <p className="text-[var(--danger-text)]">{latestError.message}</p> : null}
            </div>
          </div>
        </div>
      </div>

      <ScrollArea className="min-h-0 px-6 pb-6 pt-5">
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_300px]">
          <div className="grid gap-5">
            <Section
              description="Name the profile and point it at the PostgreSQL host."
              icon={<Database className="h-4 w-4" />}
              title="Identity and network"
            >
              <Field label="Connection name" error={draftErrors.name}>
                <Input
                  data-testid="connection-name-input"
                  onChange={(event) => {
                    onUpdateDraft('name', event.currentTarget.value);
                  }}
                  value={draft.name}
                />
              </Field>

              <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_120px]">
                <Field label="Host" error={draftErrors.host}>
                  <Input
                    data-testid="connection-host-input"
                    onChange={(event) => {
                      onUpdateDraft('host', event.currentTarget.value);
                    }}
                    value={draft.host}
                  />
                </Field>
                <Field label="Port" error={draftErrors.port}>
                  <Input
                    inputMode="numeric"
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
                  <Input
                    data-testid="connection-database-input"
                    onChange={(event) => {
                      onUpdateDraft('database', event.currentTarget.value);
                    }}
                    value={draft.database}
                  />
                </Field>
                <Field label="Username" error={draftErrors.username}>
                  <Input
                    data-testid="connection-username-input"
                    onChange={(event) => {
                      onUpdateDraft('username', event.currentTarget.value);
                    }}
                    value={draft.username}
                  />
                </Field>
              </div>
            </Section>

            <Section
              description="Secrets stay in the system keychain and never render back into the form."
              icon={<KeyRound className="h-4 w-4" />}
              title="Security"
            >
              {hasStoredSecret && !replacePassword ? (
                <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-panel)] p-4 text-sm text-[var(--text-secondary)]">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="font-medium text-[var(--text-primary)]">Stored secret available</p>
                      <p className="mt-1">Credentials are already stored securely for this profile.</p>
                    </div>
                    <Badge variant="success">Keychain</Badge>
                  </div>
                  <Button
                    className="mt-4"
                    onClick={() => {
                      onToggleReplacePassword(true);
                    }}
                    size="sm"
                    type="button"
                    variant="ghost"
                  >
                    Replace password
                  </Button>
                </div>
              ) : (
                <Field
                  label={hasStoredSecret ? 'Replacement password' : 'Password'}
                  error={replacePassword && !draft.password ? 'Enter a replacement password or keep the stored secret.' : undefined}
                >
                  <div className="grid gap-3">
                    <Input
                      className={draft.password ? '' : undefined}
                      data-testid="connection-password-input"
                      onChange={(event) => {
                        onUpdateDraft('password', event.currentTarget.value);
                      }}
                      placeholder={hasStoredSecret ? 'Set a new secret' : 'Stored only in the system keychain'}
                      type="password"
                      value={draft.password ?? ''}
                    />
                    {hasStoredSecret ? (
                      <Button
                        onClick={() => {
                          onUpdateDraft('password', null);
                          onToggleReplacePassword(false);
                        }}
                        size="sm"
                        type="button"
                        variant="ghost"
                      >
                        <CircleSlash2 className="h-3.5 w-3.5" />
                        Keep stored secret
                      </Button>
                    ) : null}
                  </div>
                </Field>
              )}
            </Section>
          </div>

          <div className="grid gap-5">
            <Section
              description="Choose how aggressively the client should require TLS."
              icon={<Shield className="h-4 w-4" />}
              title="Transport"
            >
              <div className="grid gap-2">
                {SSL_OPTIONS.map((option) => (
                  <button
                    className={cn(
                      'rounded-xl border p-3 text-left transition',
                      draft.sslMode === option.value
                        ? 'border-[var(--border-accent)] bg-[var(--surface-highlight)]'
                        : 'border-[var(--border-subtle)] bg-[var(--surface-panel)] hover:border-[var(--border-strong)]',
                    )}
                    key={option.value}
                    onClick={() => {
                      onUpdateDraft('sslMode', option.value);
                    }}
                    type="button"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-sm font-medium text-[var(--text-primary)]">{option.label}</p>
                      {draft.sslMode === option.value ? <Badge variant="accent">Selected</Badge> : null}
                    </div>
                    <p className="mt-1 text-xs leading-5 text-[var(--text-secondary)]">{option.caption}</p>
                  </button>
                ))}
              </div>

              {draft.sslMode === 'insecure' ? (
                <div className="rounded-xl border border-[var(--danger-surface)] bg-[var(--danger-surface)]/40 p-3 text-sm text-[var(--danger-text)]">
                  Insecure mode accepts invalid certificates and hostnames. Use it only when the server cannot pass
                  normal TLS verification.
                </div>
              ) : null}
            </Section>

            <Section
              description="Operational notes for this profile."
              icon={<Zap className="h-4 w-4" />}
              title="Workflow"
            >
              <div className="grid gap-3 rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-panel)] p-4 text-sm text-[var(--text-secondary)]">
                <p>Testing can use an unsaved draft.</p>
                <p>Connecting requires a saved profile with no unsaved metadata.</p>
                <p>{selectedConnectionId ? 'This profile can reconnect later from local metadata.' : 'This draft only exists in the current dialog until it is saved.'}</p>
              </div>
            </Section>
          </div>
        </div>
      </ScrollArea>

      <div className="border-t border-[var(--border-subtle)] px-6 py-4">
        <div className="flex flex-wrap items-center gap-2">
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
          <Button
            className="ml-auto"
            data-testid="delete-connection-button"
            disabled={!canDelete}
            onClick={() => {
              void onDelete();
            }}
            type="button"
            variant="danger"
          >
            <Trash2 className="h-3.5 w-3.5" />
            {pending.deleting ? 'Deleting…' : 'Delete'}
          </Button>
        </div>
      </div>
    </div>
  );
}

function Section({
  children,
  description,
  icon,
  title,
}: {
  children: ReactNode;
  description: string;
  icon: ReactNode;
  title: string;
}) {
  return (
    <section className="rounded-2xl border border-[var(--border-subtle)] bg-[color-mix(in_oklch,_var(--surface-elevated)_92%,_black_8%)] p-5">
      <div className="flex items-start gap-3">
        <div className="mt-0.5 rounded-lg bg-[var(--surface-highlight)] p-2 text-[var(--accent-text)]">{icon}</div>
        <div>
          <h3 className="text-sm font-semibold text-[var(--text-primary)]">{title}</h3>
          <p className="mt-1 text-sm leading-6 text-[var(--text-secondary)]">{description}</p>
        </div>
      </div>
      <Separator className="my-4" />
      <div className="grid gap-4">{children}</div>
    </section>
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
    <label className="grid gap-2 text-sm text-[var(--text-secondary)]">
      <span className="text-[11px] uppercase tracking-[0.18em] text-[var(--text-muted)]">{label}</span>
      {children}
      {error ? <span className="text-xs text-[var(--danger-text)]">{error}</span> : null}
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
    <Button
      data-testid={dataTestId}
      disabled={disabled}
      onClick={() => {
        void onClick();
      }}
      size="sm"
      type="button"
      variant="secondary"
    >
      <Icon className="h-3.5 w-3.5" />
      {children}
    </Button>
  );
}
