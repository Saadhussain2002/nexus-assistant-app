import streamlit as st
import os
import time
import json
from google import genai
from google.genai import types

# --- Configuration ---
# Your RAG function is assumed to be defined elsewhere or handled by the chat utility.

# --- LLM Setup and Persona (Updated for Warmth) ---

# The system instruction is what dictates the model's persona, tone, and goals.
SYSTEM_INSTRUCTION = (
    "You are Nexus, a highly efficient, professional, and friendly executive assistant "
    "to the user, Meg. Your tone should be warm, collaborative, and approachable, "
    "but always focused on delivering clear, accurate, and concise assistance. "
    "NEVER respond with robot-like phrases like 'I am functioning optimally.' "
    "Instead, use natural, conversational language like 'I'm doing well, thank you for asking.' "
    "Your primary tasks are summarizing documents (RAG), drafting communication, and providing "
    "creative and technical assistance based on information from the user or the loaded documents."
)


# --- API Key and Client Initialization ---
# The app looks for the GEMINI_API_KEY set in Streamlit Secrets.
try:
    API_KEY = st.secrets["GEMINI_API_KEY"]
except KeyError:
    st.error("Error: GEMINI_API_KEY environment variable not set. Please set the key.")
    st.stop()

# Initialize the Gemini Client
try:
    client = genai.Client(api_key=API_KEY)
except Exception as e:
    st.error(f"Error initializing Gemini client: {e}")
    st.stop()


# --- Chat Functions (The Fix is in stream_gemini_response) ---

def stream_gemini_response(prompt, history, system_instruction):
    """Generates a response from the Gemini model using the provided prompt and history."""
    
    # 1. Prepare chat history for the API
    contents = []
    # Add existing chat history
    for msg in history:
        # Streamlit session state stores 'user' and 'assistant' roles
        role = 'user' if msg["role"] == 'user' else 'model'
        
        content_text = msg.get("content", "")
        
        # --- CRITICAL FIX: Only process non-empty string content to prevent TypeError ---
        # This check stops the app from crashing if a message isn't a simple string.
        if isinstance(content_text, str) and content_text:
            contents.append(types.Content(role=role, parts=[types.Part.from_text(content_text)]))
        # -----------------------------------------------------------------------------
            
    
    # Add the current user prompt
    contents.append(types.Content(role="user", parts=[types.Part.from_text(prompt)]))
    
    # 2. Configure model generation
    config = types.GenerateContentConfig(
        system_instruction=system_instruction,
        temperature=0.7 
    )
    
    # 3. Call the API
    response = client.models.generate_content_stream(
        model="gemini-2.5-pro",
        contents=contents,
        config=config,
    )
    
    # 4. Stream the response back to Streamlit
    full_response = ""
    for chunk in response:
        if chunk.text:
            full_response += chunk.text
            yield chunk.text
    
    # 5. Return the full response (needed for updating history)
    return full_response


# --- Streamlit UI ---

st.set_page_config(
    page_title="Nexus: Meg's Executive Assistant",
    page_icon="🤝",
    layout="wide",
)

st.title("🤝 Nexus: Meg's Executive Assistant")
st.caption("Custom AI powered by Gemini and local RAG.")


# Initialize chat history in session state
if "messages" not in st.session_state:
    st.session_state.messages = []

# Display chat messages from history on app rerun
for message in st.session_state.messages:
    with st.chat_message(message["role"]):
        st.markdown(message["content"])

# Handle initial welcome message
if not st.session_state.messages:
    initial_message = "Hello Meg. I'm Nexus, your executive assistant. I'm ready to help you with summaries, drafting, and project information. How can I assist you today?"
    
    with st.chat_message("assistant"):
        st.markdown(initial_message)
        
    # Ensure the message content is explicitly a string for the history append
    st.session_state.messages.append({"role": "assistant", "content": initial_message})


# Accept user input
if prompt := st.chat_input("Ask Nexus a question..."):
    # 1. Display user message
    st.session_state.messages.append({"role": "user", "content": prompt})
    with st.chat_message("user"):
        st.markdown(prompt)

    # 2. Get and stream assistant response
    with st.chat_message("assistant"):
        full_response = st.write_stream(stream_gemini_response(
            prompt, 
            st.session_state.messages, 
            SYSTEM_INSTRUCTION
        ))
        
    # 3. Add assistant response to chat history
    st.session_state.messages.append({"role": "assistant", "content": full_response})