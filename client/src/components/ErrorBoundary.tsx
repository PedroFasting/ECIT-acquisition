import React from "react";

interface ErrorBoundaryProps {
  children: React.ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
  errorInfo: React.ErrorInfo | null;
}

export default class ErrorBoundary extends React.Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null };
  }

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    this.setState({ errorInfo });
    console.error("ErrorBoundary caught:", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="p-8 max-w-4xl">
          <div className="bg-red-50 border border-red-200 rounded-xl p-6">
            <h2 className="text-lg font-bold text-red-800 mb-2">
              Runtime Error
            </h2>
            <p className="text-red-700 text-sm mb-4">
              {this.state.error?.message}
            </p>
            <pre className="bg-red-100 rounded-lg p-4 text-xs text-red-900 overflow-auto max-h-[400px] whitespace-pre-wrap">
              {this.state.error?.stack}
            </pre>
            {this.state.errorInfo && (
              <details className="mt-4">
                <summary className="text-sm text-red-600 cursor-pointer">
                  Component Stack
                </summary>
                <pre className="bg-red-100 rounded-lg p-4 text-xs text-red-900 overflow-auto max-h-[300px] whitespace-pre-wrap mt-2">
                  {this.state.errorInfo.componentStack}
                </pre>
              </details>
            )}
            <button
              onClick={() =>
                this.setState({ hasError: false, error: null, errorInfo: null })
              }
              className="mt-4 px-4 py-2 bg-red-600 text-white rounded-lg text-sm hover:bg-red-700"
            >
              Prøv igjen
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
