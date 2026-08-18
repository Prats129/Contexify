/**
 * Main Application Logic & Event Orchestration
 */
document.addEventListener('DOMContentLoaded', () => {
    // Session State
    let currentSessionId = localStorage.getItem('knowledge_ai_session') || generateUUID();
    localStorage.setItem('knowledge_ai_session', currentSessionId);
    let currentMode = 'DOCUMENT_RAG';
    let attachedDocs = [];

    // DOM Elements
    const sessionIdDisplay = document.getElementById('sessionIdDisplay');
    const docCountBadge = document.getElementById('docCountBadge');
    const dropzone = document.getElementById('dropzone');
    const fileInput = document.getElementById('fileInput');
    const uploadProgress = document.getElementById('uploadProgress');
    const uploadStatusText = document.getElementById('uploadStatusText');
    const documentList = document.getElementById('documentList');
    const activeModeBadge = document.getElementById('activeModeBadge');
    const chatHistory = document.getElementById('chatHistory');
    const chatForm = document.getElementById('chatForm');
    const messageInput = document.getElementById('messageInput');
    const sendBtn = document.getElementById('sendBtn');
    const newChatBtn = document.getElementById('newChatBtn');
    const modeButtons = document.querySelectorAll('.mode-btn');

    // Init UI
    sessionIdDisplay.textContent = currentSessionId.substring(0, 8);
    refreshDocumentList();

    // Event Listeners for Mode Switcher
    modeButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            if (btn.classList.contains('disabled')) return;
            modeButtons.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');

            currentMode = btn.dataset.mode;
            updateModeUI(currentMode);
        });
    });

    // Auto-resize textarea
    messageInput.addEventListener('input', () => {
        messageInput.style.height = 'auto';
        messageInput.style.height = Math.min(messageInput.scrollHeight, 150) + 'px';
    });

    // Handle Quick Prompt Chips
    document.querySelectorAll('.prompt-chip').forEach(chip => {
        chip.addEventListener('click', () => {
            const text = chip.dataset.prompt;
            messageInput.value = text;
            messageInput.dispatchEvent(new Event('input'));
            messageInput.focus();
        });
    });

    // New Session Button
    newChatBtn.addEventListener('click', () => {
        currentSessionId = generateUUID();
        localStorage.setItem('knowledge_ai_session', currentSessionId);
        sessionIdDisplay.textContent = currentSessionId.substring(0, 8);
        chatHistory.innerHTML = `
            <div class="welcome-banner">
                <div class="welcome-icon"><i class="fa-solid fa-wand-magic-sparkles"></i></div>
                <h2>New Chat Session Started</h2>
                <p>Upload a book or PDF document to start document-grounded QA, or ask a question directly in Web Search mode.</p>
            </div>
        `;
        attachedDocs = [];
        renderDocumentList();
    });

    // Drag and Drop Handlers
    ['dragenter', 'dragover'].forEach(eventName => {
        dropzone.addEventListener(eventName, (e) => {
            e.preventDefault();
            dropzone.classList.add('dragover');
        });
    });

    ['dragleave', 'drop'].forEach(eventName => {
        dropzone.addEventListener(eventName, (e) => {
            e.preventDefault();
            dropzone.classList.remove('dragover');
        });
    });

    dropzone.addEventListener('drop', (e) => {
        const files = e.dataTransfer.files;
        if (files.length > 0) handleFileUpload(files[0]);
    });

    fileInput.addEventListener('change', (e) => {
        if (e.target.files.length > 0) handleFileUpload(e.target.files[0]);
    });

    // File Upload Handler
    async function handleFileUpload(file) {
        uploadProgress.classList.remove('hidden');
        uploadStatusText.textContent = `Vectorizing '${file.name}'...`;

        try {
            const res = await apiService.uploadDocument(file, currentSessionId);
            showToast(res.message, 'success');
            await refreshDocumentList();
        } catch (err) {
            alert(`Upload Failed: ${err.message}`);
        } finally {
            uploadProgress.classList.add('hidden');
            fileInput.value = '';
        }
    }

    // Refresh Document List from Server
    async function refreshDocumentList() {
        try {
            const data = await apiService.listDocuments(currentSessionId);
            attachedDocs = data.documents;
            renderDocumentList();
        } catch (err) {
            console.error('Failed to list documents:', err);
        }
    }

    // Render Document List UI
    function renderDocumentList() {
        docCountBadge.textContent = `${attachedDocs.length} files`;
        if (attachedDocs.length === 0) {
            documentList.innerHTML = `
                <div class="empty-docs-placeholder">
                    <i class="fa-regular fa-file-lines"></i>
                    <p>No documents uploaded yet.</p>
                    <span>Drop a PDF/TXT to start RAG QA</span>
                </div>
            `;
            return;
        }

        documentList.innerHTML = attachedDocs.map(doc => `
            <div class="doc-card">
                <div class="doc-info">
                    <i class="${getFileIcon(doc.file_type)}"></i>
                    <div class="doc-details">
                        <span class="doc-name" title="${escapeHtml(doc.filename)}">${escapeHtml(doc.filename)}</span>
                        <span class="doc-meta">${doc.total_chunks} chunks • ${(doc.file_size_bytes / 1024).toFixed(1)} KB</span>
                    </div>
                </div>
                <button class="btn-delete-doc" onclick="deleteDoc('${doc.document_id}')" title="Delete Document">
                    <i class="fa-solid fa-trash-can"></i>
                </button>
            </div>
        `).join('');
    }

    // Global Delete Doc Wrapper
    window.deleteDoc = async (docId) => {
        if (!confirm('Are you sure you want to remove this document and purge its vectors?')) return;
        try {
            await apiService.deleteDocument(docId, currentSessionId);
            await refreshDocumentList();
        } catch (err) {
            alert(`Deletion failed: ${err.message}`);
        }
    };

    // Chat Submission Form Handler
    chatForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const query = messageInput.value.trim();
        if (!query) return;

        // Reset input
        messageInput.value = '';
        messageInput.style.height = 'auto';

        // Remove welcome banner if present
        const welcomeBanner = chatHistory.querySelector('.welcome-banner');
        if (welcomeBanner) welcomeBanner.remove();

        // Append User Message
        appendMessage('user', query);

        // Prepare Assistant Message Wrapper
        const { messageBubble, citationsContainer } = appendAssistantPlaceholder();

        // Stream Chat
        let fullResponse = '';
        sendBtn.disabled = true;

        await apiService.streamChat(currentSessionId, query, currentMode, {
            onCitations: (citations) => {
                renderCitations(citationsContainer, citations);
            },
            onToken: (token) => {
                fullResponse += token;
                messageBubble.innerHTML = formatMarkdown(fullResponse);
                chatHistory.scrollTop = chatHistory.scrollHeight;
            },
            onError: (err) => {
                messageBubble.innerHTML = `<span style="color: #EF4444;"><i class="fa-solid fa-triangle-exclamation"></i> Error: ${escapeHtml(err)}</span>`;
                sendBtn.disabled = false;
            },
            onDone: () => {
                sendBtn.disabled = false;
            }
        });
    });

    // Helper UI functions
    function appendMessage(role, content) {
        const row = document.createElement('div');
        row.className = `message-row ${role}`;
        
        const avatarIcon = role === 'user' ? '<i class="fa-solid fa-user"></i>' : '<i class="fa-solid fa-brain"></i>';
        
        row.innerHTML = `
            <div class="message-avatar">${avatarIcon}</div>
            <div class="message-content-wrapper">
                <div class="message-bubble">${formatMarkdown(content)}</div>
            </div>
        `;
        chatHistory.appendChild(row);
        chatHistory.scrollTop = chatHistory.scrollHeight;
    }

    function appendAssistantPlaceholder() {
        const row = document.createElement('div');
        row.className = 'message-row assistant';
        
        row.innerHTML = `
            <div class="message-avatar"><i class="fa-solid fa-brain"></i></div>
            <div class="message-content-wrapper">
                <div class="message-bubble"><i class="fa-solid fa-ellipsis fa-pulse"></i> Thinking...</div>
                <div class="citations-container"></div>
            </div>
        `;
        chatHistory.appendChild(row);
        chatHistory.scrollTop = chatHistory.scrollHeight;

        return {
            messageBubble: row.querySelector('.message-bubble'),
            citationsContainer: row.querySelector('.citations-container')
        };
    }

    function renderCitations(container, citations) {
        if (!citations || citations.length === 0) return;
        
        container.innerHTML = `
            <div class="citations-box">
                <div class="citations-header"><i class="fa-solid fa-quote-left"></i> Retrieved Context Citations (${citations.length})</div>
                ${citations.map(c => `
                    <div class="citation-item">
                        <div class="citation-meta">📄 ${escapeHtml(c.filename)} ${c.page_number ? '(Page ' + c.page_number + ')' : ''} • Match: ${(c.similarity_score * 100).toFixed(0)}%</div>
                        <div class="citation-snippet">"${escapeHtml(c.snippet)}"</div>
                    </div>
                `).join('')}
            </div>
        `;
    }

    function updateModeUI(mode) {
        if (mode === 'DOCUMENT_RAG') {
            activeModeBadge.className = 'mode-badge RAG';
            activeModeBadge.innerHTML = '<i class="fa-solid fa-shield-halved"></i> Document Grounded RAG';
            messageInput.placeholder = 'Ask any question based on your uploaded document content...';
        } else if (mode === 'WEB_SEARCH') {
            activeModeBadge.className = 'mode-badge WEB';
            activeModeBadge.innerHTML = '<i class="fa-solid fa-globe"></i> Live Web Search';
            messageInput.placeholder = 'Ask a question to search the internet in real-time...';
        }
    }

    function getFileIcon(ext) {
        if (ext === '.pdf') return 'fa-solid fa-file-pdf';
        if (ext === '.txt' || ext === '.md') return 'fa-solid fa-file-lines';
        return 'fa-solid fa-file';
    }

    function generateUUID() {
        return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
            var r = Math.random() * 16 | 0, v = c == 'x' ? r : (r & 0x3 | 0x8);
            return v.toString(16);
        });
    }

    function escapeHtml(text) {
        const div = document.createElement('div');
        div.innerText = text;
        return div.innerHTML;
    }

    function formatMarkdown(text) {
        // Lightweight markdown parsing for bold, code blocks, bullet points
        let formatted = escapeHtml(text);
        formatted = formatted.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
        formatted = formatted.replace(/\*(.*?)\*/g, '<em>$1</em>');
        formatted = formatted.replace(/`([^`]+)`/g, '<code>$1</code>');
        formatted = formatted.replace(/\n/g, '<br>');
        return formatted;
    }

    function showToast(msg) {
        console.log('[Toast]', msg);
    }
});
