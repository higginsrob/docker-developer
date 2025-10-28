# Project Overview

This document provides a high-level overview of the "Docker Developer" application, its architecture, and its key components.

## Application Architecture

The application is built using the following technologies:

-   **Electron**: For building the cross-platform desktop application.
-   **TypeScript**: For static typing and improved developer experience.
-   **React**: For building the user interface.
-   **Redux**: For state management.
-   **Socket.io**: For real-time communication between the main process and the renderer process.

## APP Sections

### Images

-   This section shows all the current docker images on the machine, their tag, size, and create date, and a button to launch that image which will display a form to allow the user to configure the process before launching. We should also show the total size of all images.

### Models

-   Similar to 'Images' section but this is the list of AI model images.  We should also show the total size of all AI images.

### Containers

-   This section shows all the currently running or stopped containers.  For each row we will display that containers name, status, cpu usage, memory usage, and disk usage.  Clicking on a container will expand the view to show real-time logs and a web emulated terminal shell to exec inside the container.

### AI Model Runner

-   Similar to 'Containers' but this is the list of any running AI processes. Clicking on an ai model runner will open it's chat UI.

### Projects

-   This section will be for each project (github repo) we've added.  This will alow us to select the current target project.  Selecting a new/different projct will control what we show in our chat and version control sections.  This will allow a user to quickly switch between multiple projects and keep agents and chat histories pinned to each specific project.

#### Chat

##### Chat Header

-   Buttons: 'new', 'history', 'settings', and 'close'

##### Chat Prompt
-   We will include a range input to control "Thinking" number of tokens.  Under that we will have an Agent select box that switches the agent mode between "Chat", "Gather", and "Agent".  Next to that we will have a select box of available models.  Last, we have our "send" button.

##### Chat Response

This window holds the prompts and responses while talking to our AI. Pressing enter or the "send" button in the chat prompt section will cause that prompt text to become un-editable, then when the request has been made we will remove all text from the prompt section and add this input prompt to the chat reponse section.  By default these reponses should not be more than 3 lines long with the rest of the text hidden until you press a "more" button to toggle expanding the view.  Similar to this, the responses from our AI should initially be shown up to 10 lines long, but when the AI moves on to it's next task the response should collapse into a single line, with a more button that allows the developer to expand that response.

##### Chat History

This view is shown when pressing the "history" buton in chat window.  This will show the titles of each chat session we've started, how many tokens that session has used, how many changed lines are in that session, and if it's currently processing.  clicking on a chat will drop us into that chat to continue where we left off.

#### Version Control

##### Working Directory

-   This view allows users to see the currently selected "App"s git version control.  It will show modified and staged files and number of changed lines per file in a "changes" section.
-   Above this section we will add buttons for "Generate Commit Message" and "Generate PR", in both cases we will use one of the AI runners to study the codebase and generate a summary.  In the "Generate PR" case, we will also push that PR to github.

##### Diff

-   This view will allow us to see the differences between two different files, or the difference between two different versions of the same file in git-history, or the difference between what the AI coding agent

##### Graph

-   This view will map out the git history to better understand the current state of version control.

##### Browse

-   This view allows us to see the files in the current working directory.  Clicking on a file will open it up in the edit view.

##### Edit

-   This view is just a terminal emulator running VIM on the backend. Exitiing vim will close this edit view.
