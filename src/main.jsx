import React from 'react'
import ReactDOM from 'react-dom/client'

// Catch module-level errors too
function showError(msg) {
  var root = document.getElementById('root')
  if (root) root.innerHTML = '<pre style="background:#09090B;color:#F87171;padding:30px;margin:0;min-height:100vh;white-space:pre-wrap;font-family:monospace;font-size:13px">ERRORE:\n\n' + msg + '</pre>'
}

window.onerror = function(msg, src, line, col, err) {
  showError((err ? err.stack : msg) || msg)
}

window.addEventListener('unhandledrejection', function(e) {
  showError(e.reason ? (e.reason.stack || e.reason.toString()) : String(e))
})

class ErrorBoundary extends React.Component {
  constructor(props) { super(props); this.state = { error: null }; }
  static getDerivedStateFromError(error) { return { error: error.toString() + '\n' + (error.stack||'') }; }
  render() {
    if (this.state.error) {
      return React.createElement('pre', {
        style: { background:'#09090B', color:'#F87171', padding:'30px', margin:0, minHeight:'100vh', whiteSpace:'pre-wrap', fontFamily:'monospace', fontSize:'13px' }
      }, 'ERRORE REACT:\n\n' + this.state.error)
    }
    return this.props.children
  }
}

import('./App.jsx').then(function(mod) {
  var App = mod.default
  ReactDOM.createRoot(document.getElementById('root')).render(
    React.createElement(ErrorBoundary, null, React.createElement(App))
  )
}).catch(function(err) {
  showError('IMPORT ERROR:\n' + (err.stack || err.message || String(err)))
})
