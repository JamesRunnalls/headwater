import React, { Component } from "react";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import ErrorBoundary from "./components/errorboundary/errorboundary";
import Home from "./pages/home/home";
import "./App.css";

class App extends Component {
  state = {
    languages: ["EN", "DE", "FR", "IT"],
    language:
      JSON.parse(localStorage.getItem("language")) === null
        ? "EN"
        : JSON.parse(localStorage.getItem("language")),
  };
  setLanguage = (event) => {
    localStorage.setItem("language", JSON.stringify(event.target.value));
    this.setState({ language: event.target.value });
  };
  render() {
    return (
      <React.Fragment>
        <div className="main">
          <div className="background" />
          <BrowserRouter>
            <Routes>
              <Route
                path="/*"
                element={
                  <ErrorBoundary {...this.props} {...this.state}>
                    <Home {...this.state} setLanguage={this.setLanguage} />
                  </ErrorBoundary>
                }
              />
            </Routes>
          </BrowserRouter>
        </div>
      </React.Fragment>
    );
  }
}

export default App;
