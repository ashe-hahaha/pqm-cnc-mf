FROM ghcr.io/astral-sh/uv:0.10 AS uv
FROM python:3.12-slim
WORKDIR /app
COPY --from=uv /uv /usr/local/bin/uv
COPY pyproject.toml uv.lock ./
RUN uv sync --locked --no-dev --no-install-project --all-extras
COPY app/ app/
RUN useradd --system --uid 10001 --no-create-home app \
    && mkdir -p /app/data/microscope \
    && chown app /app/data/microscope
ENV PATH="/app/.venv/bin:${PATH}" HOST=0.0.0.0 PORT=8000
USER app
EXPOSE 8000
CMD ["python", "-m", "app"]
