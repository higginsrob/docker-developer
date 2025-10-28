# Getting Started

This document provides instructions for setting up the development environment and running the "Docker Developer" application.

## Prerequisites

Before you begin, ensure you have the following installed on your system:

- **Node.js**: [Download & Install Node.js](https://nodejs.org/)
- **npm** or **yarn**: npm is included with Node.js. Yarn can be installed from [here](https://yarnpkg.com/).
- **Git**: [Download & Install Git](https://git-scm.com/)
- **Docker**: [Download & Install Docker Desktop](https://www.docker.com/products/docker-desktop)

## Installation

1.  **Clone the repository:**
    ```shell
    git clone <repository-url>
    cd docker-developer
    ```

2.  **Install dependencies:**
    ```shell
    npm install
    ```
    or if you are using yarn:
    ```shell
    yarn install
    ```

## Development

To run the application in development mode, which will typically enable hot-reloading:

```shell
npm run dev
```

## Build

To build the application for production:

```shell
npm run build
```

This will create a distributable application package in a `dist` or `build` directory.

## Testing

To run the test suite:

```shell
npm test
```

## Linting

To check the code for any linting errors:

```shell
npm run lint
```
