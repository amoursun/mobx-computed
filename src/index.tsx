import React from 'react';
// import { Provider } from 'mobx-react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter as Router, Routes, Route, Link, useRoutes } from 'react-router-dom';
import Home from './home';

// Create a root.
const container: Element | DocumentFragment | null = document.getElementById('root');
const root = ReactDOM.createRoot(container as Element | DocumentFragment);

const App = () => {
    const routes = useRoutes([{ path: '/', element: <Home /> }]);
    return routes;
};

root.render(
    <Router>
        <App />
    </Router>
);
