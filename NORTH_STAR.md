# Project North Star

## 1. Project Overview

This project aims to build a **modern desktop database client** designed to replace slow, bloated tools like DBeaver, DataGrip, and similar products.

The core idea is simple:

> A database client that feels **instant**, **clean**, and **focused**.

Most current tools accumulated years of features, legacy UI decisions, and heavy architectures. The result is slow startup, sluggish tables, cluttered interfaces, and poor UX.

We want to build a tool that developers actually **enjoy using every day**.

The priorities are:

- Fast startup
- Fast query execution
- Smooth result browsing
- Clean UI
- Keyboard-first workflows
- Minimal friction

This is **not** an enterprise platform.  
This is a **developer tool**.

The project should favor **clarity, speed, and usability** over feature bloat.

---

# 2. Vision

The long-term goal is to create:

> The fastest and most enjoyable desktop database client available.

If a user opens the app, runs a query, and explores results, the experience should feel **effortless and responsive**.

Key product characteristics:

- Instant startup
- No UI freezes
- Smooth scrolling through large result sets
- Clean and minimal UI
- Smart defaults
- Great keyboard shortcuts
- Powerful query editing
- Safe handling of credentials
- Cross-platform (Mac, Linux, Windows)

The product should feel closer to **VS Code quality** than traditional database tools.

---

# 3. Core Principles

These principles guide every technical and product decision.

### Speed is the primary feature

If something slows down the UI, it is a bug.

Large queries, schema browsing, and result rendering must never freeze the interface.

---

### Simplicity beats feature count

A smaller set of well-designed features is better than a long list of half-baked capabilities.

We prioritize:

- clean UX
- discoverable workflows
- minimal cognitive load

---

### Build for developers

This tool is built **by developers, for developers**.

Priorities include:

- keyboard navigation
- command palette
- query history
- saved queries
- fast schema search

---

### Performance first architecture

We deliberately separate UI and heavy logic so the UI remains responsive.

Expensive operations must happen outside the UI thread.

---

### Progressive scope

We start small and focused.

The MVP supports **one database engine well**, rather than many engines poorly.

---

# 4. Architecture Overview

The application uses a **hybrid architecture** combining a web frontend with a native backend.

## High-level architecture

Frontend (UI)

- React
- TypeScript
- Vite
- Tailwind
- component libraries

Native backend

- Rust
- async runtime
- database drivers
- query execution
- connection management

Desktop shell

- Tauri

This architecture gives us:

- fast UI development
- native performance
- small binaries
- strong system integration

---

# 5. Technology Choices

## Desktop shell

Tauri

Why:

- lightweight
- secure
- small application size
- native performance
- strong Rust integration

---

## Frontend

React + TypeScript

Why:

- mature ecosystem
- strong tooling
- developer familiarity
- excellent component ecosystem

Supporting tools:

- Vite
- Tailwind
- Radix UI / shadcn
- TanStack Table
- Monaco Editor

---

## Backend

Rust

Why:

- high performance
- memory safety
- great async ecosystem
- excellent database libraries

Rust handles:

- query execution
- connection pooling
- schema introspection
- streaming results
- SSH tunnels
- credential handling

---

## Local data storage

Embedded database (DuckDB or SQLite)

Used for:

- query history
- cached metadata
- local analytics
- saved queries

---

# 6. Data Flow

Typical query flow:

1. User writes query in editor
2. Frontend sends query to backend
3. Rust executes query asynchronously
4. Results stream back to frontend
5. UI renders rows using virtualization

Key design rule:

> Never load large result sets fully into the UI.

Rows must be streamed and rendered incrementally.

---

# 7. Performance Strategy

Performance is a **core design constraint**.

Key techniques:

UI

- virtualized tables
- minimal re-renders
- efficient state management

Backend

- async query execution
- streaming rows
- background schema introspection
- query cancellation

Caching

- schema metadata cache
- connection reuse
- lazy loading of schema nodes

---

# 8. Security Principles

Credentials and connections must be handled safely.

Requirements:

- use OS keychain when possible
- never store passwords in plaintext
- support SSL connections
- secure SSH tunneling
- minimize credential exposure

---

# 9. Developer Experience

The project must be pleasant to contribute to.

We prioritize:

- clear architecture
- minimal magic
- small modules
- good documentation
- strong typing
- fast builds

Key rules:

- avoid over-engineering
- avoid unnecessary abstractions
- keep modules focused

---

# 10. Do's and Don'ts

## Do

Prioritize performance.

Keep the UI clean and simple.

Focus on developer workflows.

Ship small improvements frequently.

Build the core experience before advanced features.

Measure performance early.

Keep dependencies minimal.

---

## Don't

Do not support many databases early.

Do not add features that slow down the UI.

Do not over-design plugin systems.

Do not block the UI thread.

Do not optimize prematurely outside core paths.

Do not sacrifice usability for technical elegance.

---

# 11. Long-Term Direction

Once the core product is stable, we may explore:

Additional database engines

- MySQL
- SQLite
- ClickHouse
- Snowflake

Advanced capabilities

- query plans visualization
- charts and quick analytics
- ER diagrams
- data editing
- collaboration features

Possible ecosystem

- plugin system
- cloud sync
- query sharing

These features should only be explored **after the core product is excellent**.

---

# 12. Success Criteria

The product is successful if:

- developers prefer it over heavier tools
- queries run smoothly
- result browsing feels instant
- the UI feels modern and clean
- startup time is minimal
- the app remains responsive under heavy workloads

The ultimate benchmark:

> If using other database clients starts to feel slow and frustrating.

---

# 13. Final Philosophy

This project is about **craftsmanship**.

We are not trying to build the biggest database tool.

We are trying to build the **best everyday database client**.

A tool developers open dozens of times a day and trust to work instantly.