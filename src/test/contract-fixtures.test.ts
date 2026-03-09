import appBootstrapFixture from '../../fixtures/contracts/app-bootstrap.json';
import appErrorFixture from '../../fixtures/contracts/app-error.json';
import backgroundJobAcceptedFixture from '../../fixtures/contracts/background-job-accepted.json';
import backgroundJobProgressFixture from '../../fixtures/contracts/background-job-progress.json';
import {
  isAppBootstrap,
  isAppError,
  isBackgroundJobAccepted,
  isBackgroundJobProgressEvent,
} from '../lib/contracts';

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
});
