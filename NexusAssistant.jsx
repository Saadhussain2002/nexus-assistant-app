import React, { useState, useCallback, useEffect, useMemo } from 'react';
import { Send, Loader, Users, Command, Settings, ChevronRight, X, Save, FileText, Trash2, Maximize2, Minimize2 } from 'lucide-react';

// --- FIREBASE IMPORTS ---
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, signInWithCustomToken, onAuthStateChanged } from 'firebase/auth';
import { getFirestore, doc, addDoc, onSnapshot, collection, query, serverTimestamp, deleteDoc } from 'firebase/firestore';
import { setLogLevel } from 'firebase/firestore';

// Set Firebase log level to debug for better console feedback
setLogLevel('debug');

// --- Global Variables (Injected by Canvas Environment) ---
const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';
const firebaseConfig = typeof __firebase_config !== 'undefined' ? JSON.parse(__firebase_config) : {};
const initialAuthToken = typeof __initial_auth_token !== 'undefined' ? __initial_auth_token : null;

// --- API Configuration ---
const MODEL_NAME = 'gemini-2.5-flash-preview-09-2025'; 
const API_BASE_URL = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL_NAME}:generateContent`;
const API_KEY = ""; // Canvas environment handles the key injection.

// --- Nexus Persona (System Instruction) ---
const NEXUS_SYSTEM_INSTRUCTION = `
You are Nexus, a highly efficient, professional, and dedicated Executive Assistant to "Meg."
Your purpose is to assist with executive tasks, scheduling, strategic information retrieval, and system automation.

## Persona Rules:
1.  **Tone & Style:** Professional, precise, proactive, and concise. Avoid unnecessary conversational padding, emojis, or overly informal language.
2.  **Self-Reference:** Always refer to yourself as "Nexus."
3.  **Grounding:** When provided with RAG context (document snippets), **ALWAYS** use that information to construct your answer. Do not contradict or ignore the provided context. If the context is insufficient, state that more information is required from the local knowledge base.
`;

// --- Tool Specifications (Informs the AI what functions are available) ---
const TOOL_SPECIFICATIONS = [
    {
        "name": "send_email",
        "description": "Drafts and/or sends an email through the local system's mail client. Use this for drafting or sending emails.",
        "parameters": {
            "type": "OBJECT",
            "properties": {
                "recipient": {"type": "STRING"},
                "subject": {"type": "STRING"},
                "body": {"type": "STRING"}
            },
            "required": ["recipient", "subject", "body"]
        }
    },
    {
        "name": "retrieve_document_context",
        "description": "Searches the local RAG knowledge base (Firestore Documents) for specific information from Meg's private documents (e.g., project budgets, meeting minutes, goals). Use this when the user asks a question about their private information.",
        "parameters": {
            "type": "OBJECT",
            "properties": {
                "query": {"type": "STRING", "description": "The exact user question to search for in the documents."}
            },
            "required": ["query"]
        }
    }
];

// --- Mock initial history ---
const INITIAL_HISTORY = [
    {
        role: 'assistant',
        text: "I am functioning correctly. Please use the **Knowledge Base** settings panel on the right to upload some private documents for strategic information retrieval.",
        timestamp: Date.now() - 1000
    }
];

// --- Helper Components ---

// Simple Markdown Parser for responses
const MarkdownText = ({ text }) => {
    if (!text) return null;

    let processedText = text.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
    processedText = processedText.replace(/\*(.*?)\*/g, '<em>$1</em>');
    processedText = processedText.replace(/`(.*?)`/g, '<code class="bg-gray-200 text-sm p-1 rounded">$1</code>');

    // Convert list items
    processedText = processedText.replace(/^- (.*$)/gim, '<li class="ml-4 list-disc">$1</li>');
    
    // Add UL wrapper if list items exist
    if (processedText.includes('<li')) {
        processedText = `<ul>${processedText}</ul>`;
    }

    // Convert newlines to paragraph breaks, handling lists gracefully
    processedText = processedText.replace(/\n\n/g, '</p><p>');
    processedText = `<p>${processedText}</p>`;
    processedText = processedText.replace(/<p><\/p>/g, ''); 
    
    return <div className="text-gray-700 leading-relaxed text-sm" dangerouslySetInnerHTML={{ __html: processedText }} />;
};

// Single chat message bubble
const ChatBubble = ({ message }) => {
    const isUser = message.role === 'user';
    const isRAG = message.isRAG;

    return (
        <div className={`flex mb-4 ${isUser ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[80%] p-3 rounded-xl shadow-md transition-all ${
                isUser 
                    ? 'bg-indigo-600 text-white rounded-br-none' 
                    : 'bg-white text-gray-800 rounded-tl-none border border-gray-100'
            }`}>
                <div className="font-semibold mb-1 text-sm flex items-center">
                    {isUser ? 'Meg' : 'Nexus'}
                    {isRAG && (
                        <span className="ml-2 px-2 py-0.5 text-xs font-medium bg-green-100 text-green-700 rounded-full border border-green-300">
                            Knowledge Base Used
                        </span>
                    )}
                </div>
                {isUser ? (
                    <p className="text-sm">{message.text}</p>
                ) : (
                    <MarkdownText text={message.text} />
                )}
            </div>
        </div>
    );
};


// --- Main Application Component ---
const App = () => {
    // --- State Management ---
    const [input, setInput] = useState('');
    const [history, setHistory] = useState(INITIAL_HISTORY);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState(null);
    const [isSettingsOpen, setIsSettingsOpen] = useState(true); // Start open to guide user
    
    // Firestore State
    const [db, setDb] = useState(null);
    const [auth, setAuth] = useState(null);
    const [userId, setUserId] = useState(null);
    const [isAuthReady, setIsAuthReady] = useState(false);
    
    // Knowledge Base State
    const [documents, setDocuments] = useState([]);
    const [newDocumentTitle, setNewDocumentTitle] = useState('');
    const [newDocumentContent, setNewDocumentContent] = useState('');

    const chatContainerRef = React.useRef(null);
    const inputRef = React.useRef(null);

    // Scroll to bottom whenever history updates
    useEffect(() => {
        if (chatContainerRef.current) {
            chatContainerRef.current.scrollTop = chatContainerRef.current.scrollHeight;
        }
    }, [history]);

    // --- Firebase Initialization and Auth ---
    useEffect(() => {
        if (!firebaseConfig.apiKey) return;
        
        try {
            const app = initializeApp(firebaseConfig);
            const firestoreDb = getFirestore(app);
            const firebaseAuth = getAuth(app);
            
            setDb(firestoreDb);
            setAuth(firebaseAuth);

            // Authentication Listener
            const unsubscribeAuth = onAuthStateChanged(firebaseAuth, async (user) => {
                if (user) {
                    setUserId(user.uid);
                    setIsAuthReady(true);
                    console.log(`[Firebase] User authenticated: ${user.uid}`);
                } else {
                    // Sign in anonymously if no token is provided
                    if (!initialAuthToken) {
                        await signInAnonymously(firebaseAuth).catch(e => console.error("Anonymous Sign-in failed:", e));
                    }
                }
            });

            // Handle custom token sign-in if available
            if (initialAuthToken) {
                signInWithCustomToken(firebaseAuth, initialAuthToken)
                    .catch(e => {
                        console.error("[Firebase] Custom token sign-in failed, falling back to anonymous:", e);
                        if (!firebaseAuth.currentUser) {
                            signInAnonymously(firebaseAuth);
                        }
                    });
            } else if (!firebaseAuth.currentUser) {
                // If no token, and not already signed in, sign in anonymously
                signInAnonymously(firebaseAuth);
            }

            return () => unsubscribeAuth();

        } catch (e) {
            console.error("Firebase Initialization Error:", e);
            setError("Failed to initialize Firebase services.");
        }
    }, []);

    // --- Firestore Data Listener (RAG Documents) ---
    useEffect(() => {
        if (!db || !isAuthReady || !userId) return;

        // Private Collection Path: /artifacts/{appId}/users/{userId}/knowledge_base
        const documentsRef = collection(db, 'artifacts', appId, 'users', userId, 'knowledge_base');
        const docQuery = query(documentsRef);

        const unsubscribe = onSnapshot(docQuery, (snapshot) => {
            const fetchedDocs = snapshot.docs.map(doc => ({
                id: doc.id,
                ...doc.data(),
                createdAt: doc.data().createdAt?.toDate() // Convert Firestore Timestamp to JS Date
            }));
            // Sort by creation time, newest first
            fetchedDocs.sort((a, b) => (b.createdAt?.getTime() || 0) - (a.createdAt?.getTime() || 0));
            setDocuments(fetchedDocs);
            console.log(`[Firestore] Fetched ${fetchedDocs.length} documents for RAG.`);
        }, (err) => {
            console.error("[Firestore] Documents fetch error:", err);
            setError("Failed to load Knowledge Base documents.");
        });

        return () => unsubscribe();
    }, [db, isAuthReady, userId]);

    // --- RAG (Knowledge Base) Functions ---

    // 1. Save Document (Meg's input)
    const saveDocument = async (e) => {
        e.preventDefault();
        if (!newDocumentTitle.trim() || !newDocumentContent.trim() || !db || !userId) {
            setError("Title and Content cannot be empty. Authentication must be ready.");
            return;
        }

        try {
            const documentsRef = collection(db, 'artifacts', appId, 'users', userId, 'knowledge_base');
            await addDoc(documentsRef, {
                title: newDocumentTitle.trim(),
                content: newDocumentContent.trim(),
                createdAt: serverTimestamp(),
            });
            setNewDocumentTitle('');
            setNewDocumentContent('');
            setError(null);
            alert("Document saved to Nexus Knowledge Base successfully."); // Using native alert here as a simple status indicator for the RAG part
        } catch (err) {
            console.error("Error saving document:", err);
            setError("Failed to save document. Check console for details.");
        }
    };

    // 2. Delete Document
    const deleteDocument = async (id) => {
        if (!window.confirm("Are you sure you want to delete this document from the Knowledge Base?")) return;
        if (!db || !userId) return;
        
        try {
            const docPath = doc(db, 'artifacts', appId, 'users', userId, 'knowledge_base', id);
            await deleteDoc(docPath);
            setError(null);
        } catch (err) {
            console.error("Error deleting document:", err);
            setError("Failed to delete document.");
        }
    };

    // 3. Document Context Retriever (Local Function for the Model)
    const retrieveDocumentContext = useCallback((query) => {
        // Simple search: find documents where the query appears in title or content
        const searchResults = documents.filter(doc => 
            doc.title.toLowerCase().includes(query.toLowerCase()) || 
            doc.content.toLowerCase().includes(query.toLowerCase())
        ).slice(0, 3); // Limit to top 3 relevant documents

        if (searchResults.length === 0) {
            return JSON.stringify({ context: "No relevant private documents found in the knowledge base." });
        }

        // Concatenate results for the model to use as RAG context
        const context = searchResults.map(doc => 
            `--- Document: ${doc.title} ---\n${doc.content}\n---`
        ).join('\n\n');

        return JSON.stringify({ context: context });
    }, [documents]);

    // --- Core Chat Logic ---
    
    // Construct the chat history for the Gemini API
    const chatHistory = useMemo(() => {
        return history.map(msg => ({
            role: msg.role === 'user' ? 'user' : 'model',
            parts: [{ text: msg.text }]
        }));
    }, [history]);
    
    const handleSend = async (e) => {
        if (e) e.preventDefault();
        const userQuery = input.trim();
        if (!userQuery) return;

        // 1. Add user message to history
        const newUserMessage = { role: 'user', text: userQuery, timestamp: Date.now() };
        setHistory(prev => [...prev, newUserMessage]);
        setInput('');
        setIsLoading(true);
        setError(null);

        try {
            let nextContents = [...chatHistory, { role: 'user', parts: [{ text: userQuery }] }];
            let isRAG = false;

            // --- Function Calling Loop ---
            for (let i = 0; i < 2; i++) { // Loop max twice (initial call + function result call)
                
                const url = `${API_BASE_URL}?key=${API_KEY}`;
                
                const payload = {
                    contents: nextContents,
                    tools: [{ functionDeclarations: TOOL_SPECIFICATIONS }], 
                    systemInstruction: { parts: [{ text: NEXUS_SYSTEM_INSTRUCTION }] },
                    // Only use Google Search if RAG (internal documents) isn't explicitly used, 
                    // or if the tool is not being called.
                    config: (i === 0 && !isRAG) ? { tools: [{ "google_search": {} }] } : {} 
                };

                const headers = { 'Content-Type': 'application/json' };

                // 2. Fetch response (with backoff)
                let response = null;
                let result = null;
                const maxRetries = 4;
                
                for (let attempt = 0; attempt < maxRetries; attempt++) {
                    try {
                        response = await fetch(url, {
                            method: 'POST',
                            headers: headers,
                            body: JSON.stringify(payload)
                        });

                        if (!response.ok) {
                            throw new Error(`API Request failed with status: ${response.status}`);
                        }
                        
                        result = await response.json();
                        break; 
                    } catch (err) {
                        if (attempt === maxRetries - 1) throw err;
                        const delay = Math.pow(2, attempt) * 1000 + (Math.random() * 500);
                        await new Promise(resolve => setTimeout(resolve, delay));
                    }
                }
                
                // 3. Process result
                const candidate = result?.candidates?.[0];
                if (!candidate) throw new Error("No candidate response from API.");

                const part = candidate.content?.parts?.[0];

                if (part?.functionCall) {
                    // --- Function Call Detected (Execute Local Tool) ---
                    const funcName = part.functionCall.name;
                    const args = part.functionCall.args;
                    let functionResponse = null;

                    if (funcName === 'retrieve_document_context') {
                        // ACTUAL RAG EXECUTION
                        functionResponse = retrieveDocumentContext(args.query);
                        isRAG = true;
                    } else {
                        // SIMULATED TOOL EXECUTION (like send_email)
                        const funcArgs = JSON.stringify(args, null, 2);
                        const simulationText = `
                            **Action Logged:** Nexus has successfully parsed your command.
                            **Tool:** \`${funcName}\`
                            **Arguments:** \`\`\`json\n${funcArgs}\n\`\`\`
                            *This command has been successfully queued for execution by your local Nexus agent (simulated).* How may I assist with a knowledge-based or strategic query while your agent runs the command?
                        `;
                        // Stop the loop and present the simulation log
                        const newAssistantMessage = { role: 'assistant', text: simulationText, timestamp: Date.now() };
                        setHistory(prev => [...prev, newAssistantMessage]);
                        setIsLoading(false);
                        return;
                    }

                    // Add function call and result to history for the next API call
                    nextContents.push({ role: 'model', parts: [{ functionCall: { name: funcName, args: args } }] });
                    nextContents.push({ role: 'tool', parts: [{ functionResponse: { name: funcName, response: functionResponse } }] });
                    
                    // Continue loop to get the final text response based on the function result

                } else if (part?.text) {
                    // --- Final Text Response Detected ---
                    const newAssistantMessage = { role: 'assistant', text: part.text, timestamp: Date.now(), isRAG: isRAG };
                    setHistory(prev => [...prev, newAssistantMessage]);
                    setIsLoading(false);
                    return;

                } else {
                    // Fallback for unexpected response structure
                    throw new Error("API returned an unexpected response format.");
                }
            }
            
            // If the loop finishes without a return (shouldn't happen with maxRetries and a tool result), handle as error
            throw new Error("Nexus could not finalize the response after tool execution.");

        } catch (err) {
            console.error("Gemini API Error:", err);
            setError(`Nexus encountered a critical error: ${err.message}. Please try again.`);
        } finally {
            setIsLoading(false);
            if (inputRef.current) inputRef.current.focus();
        }
    };
    
    // --- UI Structure ---
    
    // Calculate chat area width based on settings panel state
    const chatAreaClasses = isSettingsOpen 
        ? 'w-full md:w-3/5 lg:w-3/4 transition-all duration-300'
        : 'w-full transition-all duration-300';

    return (
        <div className="flex h-screen bg-gray-50 font-['Inter'] antialiased overflow-hidden">
            
            {/* Main Chat Area */}
            <div className={`flex flex-col flex-shrink-0 ${chatAreaClasses}`}>
                
                {/* Header/Title Area */}
                <header className="flex items-center justify-between p-4 bg-white shadow-md flex-shrink-0">
                    <div className="flex items-center">
                        <Command className="w-6 h-6 text-indigo-600 mr-3" />
                        <h1 className="text-xl font-bold text-gray-800">
                            Nexus: Executive Assistant
                        </h1>
                    </div>
                    <div className="flex items-center space-x-4">
                        <div className="flex items-center space-x-2 mr-2">
                            <Users className="w-5 h-5 text-gray-500" />
                            <span className="text-sm font-medium text-gray-600">Meg (User: {userId ? `${userId.substring(0, 4)}...` : 'N/A'})</span>
                        </div>
                        <button 
                            onClick={() => setIsSettingsOpen(prev => !prev)}
                            className="p-2 rounded-full text-indigo-600 hover:bg-indigo-100 transition"
                            aria-label="Toggle Settings"
                        >
                            <Settings className="w-6 h-6" />
                        </button>
                    </div>
                </header>

                {/* Chat History Container */}
                <div 
                    ref={chatContainerRef} 
                    className="flex-grow p-4 overflow-y-auto bg-gray-100"
                >
                    <div className="max-w-3xl mx-auto">
                        {history.map((msg, index) => (
                            <ChatBubble key={index} message={msg} />
                        ))}
                        
                        {/* Error Message */}
                        {error && (
                            <div className="text-red-600 bg-red-100 p-3 rounded-lg border border-red-300 shadow-sm mt-4 text-sm">
                                <p className="font-semibold">System Alert:</p>
                                <p>{error}</p>
                            </div>
                        )}
                        
                        {/* Loading Indicator */}
                        {isLoading && (
                            <div className="flex justify-start">
                                <div className="bg-white text-indigo-600 p-3 rounded-xl rounded-tl-none shadow-md border border-gray-100">
                                    <Loader className="w-5 h-5 animate-spin inline-block mr-2" />
                                    <span className="text-sm">Nexus is processing...</span>
                                </div>
                            </div>
                        )}
                    </div>
                </div>

                {/* Input Form */}
                <footer className="flex-shrink-0 p-4 bg-white border-t border-gray-200">
                    <form onSubmit={handleSend} className="max-w-3xl mx-auto flex space-x-3">
                        <input
                            ref={inputRef}
                            type="text"
                            value={input}
                            onChange={(e) => setInput(e.target.value)}
                            placeholder="Nexus, what is my priority for today? (Try: What did I say about Q4?)"
                            className="flex-grow p-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none transition duration-150 shadow-inner"
                            disabled={isLoading}
                            autoFocus
                        />
                        <button
                            type="submit"
                            className={`p-3 rounded-xl text-white font-semibold transition duration-200 shadow-lg flex items-center justify-center ${
                                isLoading || !input.trim()
                                    ? 'bg-indigo-300 cursor-not-allowed'
                                    : 'bg-indigo-600 hover:bg-indigo-700'
                            }`}
                            disabled={isLoading || !input.trim()}
                        >
                            {isLoading ? <Loader className="w-6 h-6 animate-spin" /> : <Send className="w-6 h-6" />}
                        </button>
                    </form>
                </footer>
            </div>
            
            {/* Knowledge Base Settings Sidebar */}
            {isSettingsOpen && (
                <div className="w-full md:w-2/5 lg:w-1/4 bg-gray-50 border-l border-gray-200 p-6 overflow-y-auto flex-shrink-0 transition-all duration-300 shadow-xl">
                    <div className="flex justify-between items-center mb-6">
                        <h2 className="text-xl font-bold text-gray-800 flex items-center">
                            <FileText className="w-5 h-5 mr-2 text-indigo-500" />
                            Nexus Knowledge Base
                        </h2>
                        <button 
                            onClick={() => setIsSettingsOpen(false)}
                            className="p-1 rounded-full text-gray-500 hover:bg-gray-200 transition md:hidden"
                            aria-label="Close Settings"
                        >
                            <X className="w-5 h-5" />
                        </button>
                    </div>

                    <div className="mb-8 p-4 bg-white rounded-xl shadow-md border border-indigo-100">
                        <h3 className="font-semibold text-indigo-600 mb-3 text-lg">Add Private Document</h3>
                        <p className="text-xs text-gray-500 mb-3">
                            These notes simulate your private files and are used by Nexus for RAG-powered answers.
                        </p>
                        <form onSubmit={saveDocument}>
                            <input
                                type="text"
                                value={newDocumentTitle}
                                onChange={(e) => setNewDocumentTitle(e.target.value)}
                                placeholder="Document Title (e.g., Q4 Goals)"
                                className="w-full p-2 mb-3 border border-gray-300 rounded-lg text-sm focus:ring-indigo-500"
                                required
                            />
                            <textarea
                                value={newDocumentContent}
                                onChange={(e) => setNewDocumentContent(e.target.value)}
                                placeholder="Key points and content here..."
                                rows="4"
                                className="w-full p-2 mb-3 border border-gray-300 rounded-lg text-sm resize-none focus:ring-indigo-500"
                                required
                            />
                            <button
                                type="submit"
                                className="w-full py-2 bg-indigo-500 text-white font-semibold rounded-lg hover:bg-indigo-600 transition flex items-center justify-center disabled:bg-indigo-300"
                                disabled={!db || !userId}
                            >
                                <Save className="w-4 h-4 mr-2" />
                                Save Document
                            </button>
                            {(!db || !userId) && (
                                <p className="mt-2 text-xs text-red-500">Waiting for database connection...</p>
                            )}
                        </form>
                    </div>

                    <h3 className="font-semibold text-gray-700 mb-3 text-lg border-b pb-2">Stored Documents ({documents.length})</h3>
                    <div className="space-y-3">
                        {documents.length === 0 ? (
                            <p className="text-gray-500 text-sm italic">No documents found. Add one above!</p>
                        ) : (
                            documents.map(doc => (
                                <div key={doc.id} className="bg-white p-3 rounded-lg shadow-sm border border-gray-200 flex justify-between items-center hover:shadow-md transition">
                                    <div className="flex-grow">
                                        <p className="font-medium text-gray-800 text-sm truncate">{doc.title}</p>
                                        <p className="text-xs text-gray-500 mt-1 line-clamp-2">{doc.content}</p>
                                        {doc.createdAt && (
                                            <p className="text-xs text-gray-400 mt-1">
                                                Created: {new Date(doc.createdAt).toLocaleDateString()}
                                            </p>
                                        )}
                                    </div>
                                    <button
                                        onClick={() => deleteDocument(doc.id)}
                                        className="ml-3 p-1 rounded-full text-red-500 hover:bg-red-100 transition"
                                        aria-label={`Delete ${doc.title}`}
                                    >
                                        <Trash2 className="w-4 h-4" />
                                    </button>
                                </div>
                            ))
                        )}
                    </div>

                </div>
            )}
        </div>
    );
};

export default App;