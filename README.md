# Road Estimate Inference Agent
A Groq LLM agent which uses tools to infer additional terrain/traffic information from a provided
journey.

Tools available:
- Tavily: Allows the agent to scrape TomTom website to access regional traffic information
- Google APIs - Access to both the `routes` and `elevantion` API, allowing the agent to access 
  current information about traffic, terrain, fuel usage, etc.

### Set up
Configure the following API keys in `.env` file:
- LANGSMITH_API_KEY
- TAVILY_API_KEY
- GOOGLE_ROUTES_API_KEY
- GOOGLE_ELEVATION_API_KEY
- GROQ_API_KEY

## Test run:
To run the agent run:
`yarn run-agent`

Expected output (along the lines of):
```text
fuel: gasoline,
fuel_consumed: 25,
gradient: hilly,
situation: city_urban_heavy_traffic,
```

Update `test.json` with different routes you'd like to test
