# Portfolio in Astro.

This repository contains the source code for "Infra as Thoughts," a personal technical blog focused on IT Systems Engineering, automation workflows, Apple fleet management, and cloud native operations. The site is built and based on using Astro, Vue, and UnoCSS.

## Projects

In addition to blog posts, this repository hosts a projects page showcasing personal and professional development work, including:

*   **Nightcap:** A full-stack web application for cocktail enthusiasts, built with Next.js and FastAPI, featuring an AI recipe generator.
*   **Okta and AWS Federation:** A project using Terraform to configure SAML 2.0 federation between Okta and AWS for secure SSO.
*   **FinOps AWS Cost Optimizer:** A macOS menu bar application (in development) for monitoring AWS costs.

## Tech Stack

*   **Framework:** [Astro](https://astro.build/)
*   **UI Components:** [Vue.js](https://vuejs.org/)
*   **Styling:** [UnoCSS](https://unocss.dev/)
*   **Content:** Markdown & MDX
*   **Linting & Formatting:** ESLint, Prettier
*   **Deployment:** CI/CD pipelines via GitHub Actions

## Repository Structure

The repository is organized as a standard Astro project:

*   `src/content/blog/`: Contains all blog posts and technical notes as Markdown files.
*   `src/pages/`: Defines the site's routing, including dynamic routes for blog posts and static pages like the projects list.
*   `src/components/`: Holds reusable Astro and Vue components for the header, footer, and post lists.
*   `src/layouts/`: Contains the base layout structure for all pages.
*   `src/site-config.ts`: A central configuration file for site metadata, author details, and navigation links.
*   `astro.config.ts`: Manages Astro integrations like MDX, sitemap generation, and Vue support.
*   `uno.config.ts`: Configures the UnoCSS utility-first CSS framework.

## Running Locally

To run this project on your local machine, follow these steps:

1.  Install the dependencies:
    ```bash
    npm install
    ```

2.  Start the development server:
    ```bash
    npm run dev
    ```
    This will start the development server, typically on `http://localhost:1977`.

3.  To create a production build, run:
    ```bash
    npm run build
    ```

4. Preview your build locally, before deploying
    ```bash
    npm run preview
    ```

5. Run CLI commands like `astro add`, `astro check`
    ```bash
    npm run astro
    ```
