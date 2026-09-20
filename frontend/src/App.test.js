import { fireEvent, render, screen } from '@testing-library/react';
import App from './App';

jest.mock('./components/DispatchFeed', () => () => <div>DispatchFeedMock</div>);
jest.mock('./components/BreakdownAlertsMonitor', () => () => <div>BreakdownAlertsMock</div>);
jest.mock('./components/MasterSuitePanel', () => ({ role }) => <div>MasterSuiteMock-{role}</div>);

test('renders command center and switches role panels', () => {
  render(<App />);
  expect(screen.getByText(/Grace Command Center/i)).toBeInTheDocument();
  expect(screen.getByText('DispatchFeedMock')).toBeInTheDocument();
  expect(screen.getByText('BreakdownAlertsMock')).toBeInTheDocument();

  fireEvent.change(screen.getByLabelText(/Role View/i), { target: { value: 'hr' } });
  expect(screen.queryByText('DispatchFeedMock')).not.toBeInTheDocument();
  expect(screen.queryByText('BreakdownAlertsMock')).not.toBeInTheDocument();
  expect(screen.getByText(/HR & Payroll Activity/i)).toBeInTheDocument();
  expect(screen.getByText(/MasterSuiteMock-hr/i)).toBeInTheDocument();
});
