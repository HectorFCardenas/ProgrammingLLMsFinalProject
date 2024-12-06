let currentThreadId = null;

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    console.log("Received message in background:", message);

    if (message.type === "resetThread") {
        console.log("Resetting thread...");
        resetThread()
            .then((newThreadId) => {
                if (newThreadId) {
                    console.log("Thread reset successful. New thread ID:", newThreadId);
                    currentThreadId = newThreadId;

                    // Notify popup.js of the new thread ID
                    chrome.runtime.sendMessage({ threadId: newThreadId });
                    sendResponse({ status: "success", threadId: newThreadId });
                } else {
                    console.error("Thread reset failed. No thread ID returned.");
                    sendResponse({ error: "Failed to reset thread. No thread ID returned." });
                }
            })
            .catch((error) => {
                console.error("Error resetting thread:", error);
                sendResponse({ error: `Failed to reset thread: ${error.message}` });
            });

        return true; // Keep the port open for asynchronous response
    }

    if (message.type === "getFormDetails") {
        console.log("Requesting form details from content script...");

        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            if (tabs.length === 0) {
                console.error("No active tab found.");
                sendResponse({ error: "No active tab found." });
                return;
            }

            const activeTab = tabs[0];
            chrome.tabs.sendMessage(activeTab.id, { type: "requestFormDetails" }, (response) => {
                if (chrome.runtime.lastError) {
                    console.error("Error communicating with content script:", chrome.runtime.lastError.message);
                    sendResponse({ error: "Failed to retrieve form details." });
                } else if (response && response.status === "success") {
                    console.log("Received form details from content script:", response.data);
                    sendResponse({ status: "success", data: response.data });
                } else {
                    console.error("Failed to retrieve form details from content script:", response);
                    sendResponse({ error: "Failed to retrieve form details." });
                }
            });
        });

        return true; // Keep the port open for asynchronous response
    }

    if (message.type === "addMessage") {
        console.log("Adding message to thread:", message);

        if (!currentThreadId) {
            console.error("Cannot add message. No thread ID is available.");
            sendResponse({ error: "No thread ID available. Please reset the thread first." });
            return;
        }

        // Fetch form details dynamically
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            if (tabs.length === 0) {
                console.error("No active tab found.");
                sendResponse({ error: "No active tab found." });
                return;
            }

            const activeTab = tabs[0];
            chrome.tabs.sendMessage(activeTab.id, { type: "requestFormDetails" }, (formResponse) => {
                if (chrome.runtime.lastError) {
                    console.error("Error retrieving form details:", chrome.runtime.lastError.message);
                    sendResponse({ error: "Failed to retrieve form details." });
                    return;
                }

                if (formResponse && formResponse.status === "success") {
                    const formDetails = formResponse.data || [];
                    const combinedContent = combineContentWithFormDetails(message.content, formDetails);

                    addMessageToThread(currentThreadId, combinedContent)
                        .then((response) => {
                            console.log("Message added to thread successfully:", response);
                            sendResponse({ status: "success", response });
                        })
                        .catch((error) => {
                            console.error("Error adding message to thread:", error);
                            sendResponse({ error: `Failed to add message: ${error.message}` });
                        });
                } else {
                    console.error("Failed to retrieve form details from content script:", formResponse);
                    sendResponse({ error: "Failed to retrieve form details." });
                }
            });
        });

        return true; // Keep the port open for asynchronous response
    }

    console.warn("Unknown message type received:", message.type);
    sendResponse({ error: "Unknown message type." });
});

// Helper function to combine user content and form details
function combineContentWithFormDetails(content, formDetails) {
    let combinedContent = content;

    if (formDetails && formDetails.length > 0) {
        combinedContent += `\n\nForm Context:\n`;
        formDetails.forEach((form, index) => {
            combinedContent += `Form ${index + 1}:\n`;
            combinedContent += `Action: ${form.action || "N/A"}\n`;
            combinedContent += `Method: ${form.method || "N/A"}\n`;

            if (form.inputs && form.inputs.length > 0) {
                combinedContent += `Inputs:\n`;
                form.inputs.forEach((input) => {
                    combinedContent += `  - Name: ${input.name || "N/A"}\n`;
                    combinedContent += `    Type: ${input.type || "N/A"}\n`;
                    combinedContent += `    Value: ${input.value || "N/A"}\n`;
                    combinedContent += `    Label: ${input.label || "N/A"}\n`;
                    combinedContent += `    Surrounding Text: ${input.surroundingText || "N/A"}\n`;
                });
            } else {
                combinedContent += `No inputs found.\n`;
            }
        });
    } else {
        combinedContent += `\n\nNo form context available.`;
    }

    return combinedContent;
}


async function addMessageToThread(threadId, content) {
    console.log("Sending message to thread:", threadId, content);
    try {
        const response = await fetch(`http://127.0.0.1:5000/api/sendprompt`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: threadId, content }),
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Failed to add message: ${response.statusText}. Server response: ${errorText}`);
        }

        const data = await response.json();
        console.log("Message added successfully:", data);
        return data;
    } catch (error) {
        console.error("Error adding message:", error);
        throw error;
    }
}

async function resetThread() {
    console.log("Resetting thread...");
    try {
        const newThread = await createThread();
        if (!newThread) {
            throw new Error("Failed to reset thread. CreateThread returned null.");
        }
        console.log("Reset thread successful. New thread ID:", newThread);
        return newThread;
    } catch (error) {
        console.error("Error resetting thread:", error);
        throw error;
    }
}

async function createThread() {
    console.log("Creating a new thread...");
    try {
        const response = await fetch('http://127.0.0.1:5000/api/helpthread', {
            method: 'POST',
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Failed to create thread: ${response.statusText}. Server response: ${errorText}`);
        }

        const data = await response.json();
        if (!data.id) {
            throw new Error("Response is missing the 'id' field.");
        }
        console.log("New thread created:", data.id);
        return data.id; // Return the thread ID
    } catch (error) {
        console.error("Error creating thread:", error);
        return null;
    }
}
