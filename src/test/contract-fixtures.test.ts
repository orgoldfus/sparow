import appBootstrapFixture from '../../fixtures/contracts/app-bootstrap.json';
import appErrorFixture from '../../fixtures/contracts/app-error.json';
import backgroundJobAcceptedFixture from '../../fixtures/contracts/background-job-accepted.json';
import backgroundJobProgressFixture from '../../fixtures/contracts/background-job-progress.json';
import connectionDetailsFixture from '../../fixtures/contracts/connection-details.json';
import connectionSummaryFixture from '../../fixtures/contracts/connection-summary.json';
import connectionTestResultFixture from '../../fixtures/contracts/connection-test-result.json';
import databaseSessionSnapshotFixture from '../../fixtures/contracts/database-session-snapshot.json';
import deleteConnectionResultFixture from '../../fixtures/contracts/delete-connection-result.json';
import disconnectSessionResultFixture from '../../fixtures/contracts/disconnect-session-result.json';
import listSchemaChildrenRequestFixture from '../../fixtures/contracts/list-schema-children-request.json';
import listSchemaChildrenResultFixture from '../../fixtures/contracts/list-schema-children-result.json';
import saveConnectionRequestFixture from '../../fixtures/contracts/save-connection-request.json';
import refreshSchemaScopeRequestFixture from '../../fixtures/contracts/refresh-schema-scope-request.json';
import schemaNodeFixture from '../../fixtures/contracts/schema-node.json';
import schemaRefreshAcceptedFixture from '../../fixtures/contracts/schema-refresh-accepted.json';
import schemaRefreshProgressFixture from '../../fixtures/contracts/schema-refresh-progress.json';
import schemaSearchRequestFixture from '../../fixtures/contracts/schema-search-request.json';
import schemaSearchResultFixture from '../../fixtures/contracts/schema-search-result.json';
import testConnectionRequestFixture from '../../fixtures/contracts/test-connection-request.json';
import cancelQueryExecutionResultFixture from '../../fixtures/contracts/cancel-query-execution-result.json';
import queryExecutionAcceptedFixture from '../../fixtures/contracts/query-execution-accepted.json';
import queryExecutionProgressFixture from '../../fixtures/contracts/query-execution-progress.json';
import queryExecutionRequestFixture from '../../fixtures/contracts/query-execution-request.json';
import {
  isAppBootstrap,
  isAppError,
  isBackgroundJobAccepted,
  isBackgroundJobProgressEvent,
  isConnectionDetails,
  isConnectionSummary,
  isConnectionTestResult,
  isDatabaseSessionSnapshot,
  isDeleteConnectionResult,
  isDisconnectSessionResult,
  isListSchemaChildrenRequest,
  isListSchemaChildrenResult,
  isQueryExecutionAccepted,
  isQueryExecutionProgressEvent,
  isQueryExecutionRequest,
  isQueryExecutionResult,
  isRefreshSchemaScopeRequest,
  isSaveConnectionRequest,
  isSchemaNode,
  isSchemaRefreshAccepted,
  isSchemaRefreshProgressEvent,
  isSchemaSearchRequest,
  isSchemaSearchResult,
  isTestConnectionRequest,
} from '../lib/guards';

describe('contract fixtures', () => {
  it('validate the app bootstrap fixture', () => {
    expect(isAppBootstrap(appBootstrapFixture)).toBe(true);
  });

  it('validate the app error fixture', () => {
    expect(isAppError(appErrorFixture)).toBe(true);
  });

  it('validate the background job accepted fixture', () => {
    expect(isBackgroundJobAccepted(backgroundJobAcceptedFixture)).toBe(true);
  });

  it('validate the background job progress fixture', () => {
    expect(isBackgroundJobProgressEvent(backgroundJobProgressFixture)).toBe(true);
  });

  it('validate the connection summary fixture', () => {
    expect(isConnectionSummary(connectionSummaryFixture)).toBe(true);
  });

  it('validate the connection details fixture', () => {
    expect(isConnectionDetails(connectionDetailsFixture)).toBe(true);
  });

  it('validate the save connection request fixture', () => {
    expect(isSaveConnectionRequest(saveConnectionRequestFixture)).toBe(true);
  });

  it('validate the test connection request fixture', () => {
    expect(isTestConnectionRequest(testConnectionRequestFixture)).toBe(true);
  });

  it('accepts the explicit insecure SSL mode on connection payloads', () => {
    expect(
      isConnectionSummary({
        ...connectionSummaryFixture,
        sslMode: 'insecure',
      }),
    ).toBe(true);

    expect(
      isSaveConnectionRequest({
        ...saveConnectionRequestFixture,
        draft: {
          ...saveConnectionRequestFixture.draft,
          sslMode: 'insecure',
        },
      }),
    ).toBe(true);
  });

  it('validate the connection test result fixture', () => {
    expect(isConnectionTestResult(connectionTestResultFixture)).toBe(true);
  });

  it('validate the session snapshot fixture', () => {
    expect(isDatabaseSessionSnapshot(databaseSessionSnapshotFixture)).toBe(true);
  });

  it('validate the delete connection result fixture', () => {
    expect(isDeleteConnectionResult(deleteConnectionResultFixture)).toBe(true);
  });

  it('validate the disconnect session result fixture', () => {
    expect(isDisconnectSessionResult(disconnectSessionResultFixture)).toBe(true);
  });

  it('validate the schema node fixture', () => {
    expect(isSchemaNode(schemaNodeFixture)).toBe(true);
  });

  it('validate the list schema children request fixture', () => {
    expect(isListSchemaChildrenRequest(listSchemaChildrenRequestFixture)).toBe(true);
  });

  it('validate the list schema children result fixture', () => {
    expect(isListSchemaChildrenResult(listSchemaChildrenResultFixture)).toBe(true);
  });

  it('validate the refresh schema scope request fixture', () => {
    expect(isRefreshSchemaScopeRequest(refreshSchemaScopeRequestFixture)).toBe(true);
  });

  it('validate the schema refresh accepted fixture', () => {
    expect(isSchemaRefreshAccepted(schemaRefreshAcceptedFixture)).toBe(true);
  });

  it('validate the schema refresh progress fixture', () => {
    expect(isSchemaRefreshProgressEvent(schemaRefreshProgressFixture)).toBe(true);
  });

  it('validate the schema search request fixture', () => {
    expect(isSchemaSearchRequest(schemaSearchRequestFixture)).toBe(true);
  });

  it('validate the schema search result fixture', () => {
    expect(isSchemaSearchResult(schemaSearchResultFixture)).toBe(true);
  });

  it('validate the query execution request fixture', () => {
    expect(isQueryExecutionRequest(queryExecutionRequestFixture)).toBe(true);
  });

  it('validate the query execution accepted fixture', () => {
    expect(isQueryExecutionAccepted(queryExecutionAcceptedFixture)).toBe(true);
  });

  it('validate the query execution progress fixture', () => {
    expect(isQueryExecutionProgressEvent(queryExecutionProgressFixture)).toBe(true);
  });

  it('validate the cancel query execution result fixture', () => {
    expect(typeof cancelQueryExecutionResultFixture.jobId).toBe('string');
  });

  it('rejects schema nodes without a kind discriminant', () => {
    const nodeWithoutKind = { ...schemaNodeFixture };
    delete (nodeWithoutKind as { kind?: string }).kind;
    expect(isSchemaNode(nodeWithoutKind)).toBe(false);
  });

  it('rejects root schema requests with non-null paths', () => {
    expect(
      isListSchemaChildrenRequest({
        connectionId: 'conn-local-postgres',
        parentKind: 'root',
        parentPath: 'schema/public',
      }),
    ).toBe(false);

    expect(
      isRefreshSchemaScopeRequest({
        connectionId: 'conn-local-postgres',
        scopeKind: 'root',
        scopePath: 'schema/public',
      }),
    ).toBe(false);
  });

  it('rejects non-root schema payloads with null paths', () => {
    expect(
      isListSchemaChildrenResult({
        ...listSchemaChildrenResultFixture,
        parentKind: 'schema',
        parentPath: null,
      }),
    ).toBe(false);

    expect(
      isSchemaRefreshAccepted({
        ...schemaRefreshAcceptedFixture,
        scopeKind: 'schema',
        scopePath: null,
      }),
    ).toBe(false);

    expect(
      isSchemaRefreshProgressEvent({
        ...schemaRefreshProgressFixture,
        scopeKind: 'table',
        scopePath: null,
      }),
    ).toBe(false);
  });

  it('accepts percent-encoded schema scope paths and rejects mismatched shapes', () => {
    expect(
      isListSchemaChildrenRequest({
        connectionId: 'conn-local-postgres',
        parentKind: 'schema',
        parentPath: 'schema/sales%2F2024',
      }),
    ).toBe(true);

    expect(
      isRefreshSchemaScopeRequest({
        connectionId: 'conn-local-postgres',
        scopeKind: 'table',
        scopePath: 'table/sales%2F2024/orders%2Fdaily',
      }),
    ).toBe(true);

    expect(
      isListSchemaChildrenRequest({
        connectionId: 'conn-local-postgres',
        parentKind: 'schema',
        parentPath: 'table/public/users',
      }),
    ).toBe(false);

    expect(
      isRefreshSchemaScopeRequest({
        connectionId: 'conn-local-postgres',
        scopeKind: 'view',
        scopePath: 'view/public',
      }),
    ).toBe(false);
  });

  it('rejects unknown background job statuses and app environments', () => {
    expect(
      isBackgroundJobProgressEvent({
        ...backgroundJobProgressFixture,
        status: 'paused',
      }),
    ).toBe(false);

    expect(
      isAppBootstrap({
        ...appBootstrapFixture,
        environment: 'staging',
      }),
    ).toBe(false);
  });

  it('accepts both query result variants and rejects malformed preview rows', () => {
    expect(isQueryExecutionResult(queryExecutionProgressFixture.result)).toBe(true);

    expect(
      isQueryExecutionResult({
        kind: 'command',
        commandTag: 'UPDATE 3',
        rowsAffected: 3,
      }),
    ).toBe(true);

    expect(
      isQueryExecutionResult({
        kind: 'rows',
        columns: [{ name: 'id', postgresType: 'int4' }],
        previewRows: [['1'], [2]],
        previewRowCount: 2,
        truncated: false,
      }),
    ).toBe(false);
  });

  it('rejects schema nodes with impossible path invariants', () => {
    expect(
      isSchemaNode({
        ...schemaNodeFixture,
        kind: 'schema',
        path: 'schema/public',
        parentPath: 'schema/public',
        relationName: null,
        hasChildren: true,
      }),
    ).toBe(false);

    expect(
      isSchemaNode({
        ...listSchemaChildrenResultFixture.nodes[0],
        parentPath: null,
      }),
    ).toBe(false);

    expect(
      isSchemaNode({
        ...schemaNodeFixture,
        kind: 'index',
        parentPath: 'schema/public',
      }),
    ).toBe(false);
  });

  it('rejects list schema children results with cross-connection or wrong-parent nodes', () => {
    expect(
      isListSchemaChildrenResult({
        ...listSchemaChildrenResultFixture,
        nodes: [
          {
            ...listSchemaChildrenResultFixture.nodes[0],
            connectionId: 'conn-other',
          },
        ],
      }),
    ).toBe(false);

    expect(
      isListSchemaChildrenResult({
        ...listSchemaChildrenResultFixture,
        nodes: [
          {
            ...listSchemaChildrenResultFixture.nodes[0],
            parentPath: 'schema/private',
          },
        ],
      }),
    ).toBe(false);
  });

  it('rejects schema search results with nodes from another connection', () => {
    expect(
      isSchemaSearchResult({
        ...schemaSearchResultFixture,
        nodes: [
          {
            ...schemaSearchResultFixture.nodes[0],
            connectionId: 'conn-other',
          },
        ],
      }),
    ).toBe(false);
  });

  it('accepts schema nodes whose identifiers require encoded path segments', () => {
    expect(
      isSchemaNode({
        ...schemaNodeFixture,
        kind: 'table',
        id: 'conn-local-postgres:table/sales%2F2024/orders%2Fdaily',
        name: 'orders/daily',
        path: 'table/sales%2F2024/orders%2Fdaily',
        parentPath: 'schema/sales%2F2024',
        schemaName: 'sales/2024',
        relationName: 'orders/daily',
        hasChildren: true,
      }),
    ).toBe(true);
  });
});
