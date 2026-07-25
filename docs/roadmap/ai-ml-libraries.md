# Free AI/ML Libraries for React Real Estate Platform

> Comprehensive guide to open-source, no-API-key-required AI/ML libraries suitable for a React-based real estate web application (PuneNest). All libraries listed are truly free -- no paid tiers, no cloud API keys needed.

---

## Table of Contents

1. [Search & NLP](#1-search--nlp)
2. [Image & Video Processing](#2-image--video-processing)
3. [Analytics & Recommendations](#3-analytics--recommendations)
4. [Chatbot / Conversational AI](#4-chatbot--conversational-ai)
5. [OCR & Document Processing](#5-ocr--document-processing)
6. [Foundation / Runtime Libraries](#6-foundation--runtime-libraries)
7. [Recommended Architecture for PuneNest](#7-recommended-architecture-for-punenest)

---

## 1. Search & NLP

### 1.1 FlexSearch

| Attribute | Details |
|-----------|---------|
| **What it does** | Next-generation full-text search with advanced indexing, phonetic matching, fuzzy search, autocomplete, and boolean queries |
| **License** | Apache 2.0 |
| **Runs in** | Browser (client-side) AND Node.js |
| **Maturity** | High -- 12k+ GitHub stars, actively maintained, extremely fast benchmarks (millions of queries/sec) |
| **Bundle size** | ~6KB gzipped |
| **Real Estate Use Case** | Instant property search by title, description, locality, amenities. Supports multi-field search so users can search across property name + locality + features simultaneously. Phonetic matching handles misspellings of Indian locality names (e.g., "Koregaon" vs "Koregoan") |

### 1.2 Orama

| Attribute | Details |
|-----------|---------|
| **What it does** | Full-text, vector, and hybrid search engine with BM25 ranking, typo tolerance, geosearch, facets, and RAG pipeline support -- all in under 2KB |
| **License** | Apache 2.0 |
| **Runs in** | Browser (client-side), server, and edge |
| **Maturity** | High -- rapidly growing, supports 30 languages, plugin ecosystem |
| **Real Estate Use Case** | Semantic property search using vector embeddings (find "spacious 2BHK near park" even if listing says "large two-bedroom apartment adjacent to garden"). Geosearch for location-based filtering. Faceted search for price ranges, BHK types, amenities |

### 1.3 MiniSearch

| Attribute | Details |
|-----------|---------|
| **What it does** | Lightweight in-memory full-text search with prefix search, fuzzy matching, field boosting, auto-suggestions, and dynamic indexing |
| **License** | MIT |
| **Runs in** | Browser (client-side) AND Node.js |
| **Maturity** | High -- well-documented, actively maintained, designed for real-time "as-you-type" search |
| **Bundle size** | ~7KB gzipped |
| **Real Estate Use Case** | Real-time autocomplete for property search. As users type "3 BHK Hin...", instantly suggest matching properties. Field boosting prioritizes title matches over description matches |

### 1.4 Lunr.js

| Attribute | Details |
|-----------|---------|
| **What it does** | Client-side full-text search with multi-language support (14 languages), term boosting, field filtering, wildcards, and fuzzy matching |
| **License** | MIT |
| **Runs in** | Browser (client-side) |
| **Maturity** | Very High -- established project (10+ years), stable API, widely used |
| **Real Estate Use Case** | Offline-capable property search for PWA scenarios. Pre-build index at deploy time for static property catalogs. Good for smaller datasets (< 10,000 properties) |

### 1.5 Compromise (NLP)

| Attribute | Details |
|-----------|---------|
| **What it does** | Lightweight NLP library for tokenization, POS tagging, named entity recognition, number/date/money extraction, text transformation |
| **License** | MIT |
| **Runs in** | Browser (client-side) -- ~250KB, runs on keypress |
| **Maturity** | High -- 11k+ stars, actively maintained, extensive plugin system |
| **Real Estate Use Case** | Parse natural language property queries: "3 BHK flat under 80 lakhs in Kothrud" -> extract {bhk: 3, type: "flat", maxPrice: 8000000, locality: "Kothrud"}. Entity extraction for prices, locations, dates from user input |

### 1.6 Wink-NLP

| Attribute | Details |
|-----------|---------|
| **What it does** | Fast NLP pipeline with tokenization (650K tokens/sec), POS tagging (95% accuracy), NER, sentiment analysis, negation handling, custom entity recognition |
| **License** | MIT |
| **Runs in** | Browser AND Node.js (use wink-eng-lite-web-model for browser) |
| **Maturity** | High -- zero dependencies, ~10KB minified+gzipped, well-documented |
| **Real Estate Use Case** | Sentiment analysis on property reviews. Custom entity recognition for real estate terms (carpet area, built-up area, RERA number). Parse property descriptions to extract structured features |

### 1.7 Natural (NLP)

| Attribute | Details |
|-----------|---------|
| **What it does** | Comprehensive NLP toolkit: tokenization, stemming, classification (Naive Bayes, logistic regression), TF-IDF, phonetics, string distance, WordNet integration |
| **License** | MIT |
| **Runs in** | Node.js backend (not browser-native) |
| **Maturity** | Very High -- 10.9k stars, long-standing project, extensive documentation |
| **Real Estate Use Case** | Backend text classification for property listings (categorize as residential/commercial/plot). TF-IDF for finding similar property descriptions. Naive Bayes classifier to auto-tag property features from descriptions |

---

## 2. Image & Video Processing

### 2.1 Transformers.js (Hugging Face)

| Attribute | Details |
|-----------|---------|
| **What it does** | Run 170+ pre-trained model architectures in-browser: image classification, object detection, image segmentation, depth estimation, zero-shot classification, and more |
| **License** | Apache 2.0 |
| **Runs in** | Browser (WebAssembly + optional WebGPU) AND Node.js |
| **Maturity** | Very High -- backed by Hugging Face, rapidly growing ecosystem, extensive model hub |
| **Real Estate Use Case** | **Object detection** in property photos (detect rooms, furniture, appliances). **Image classification** (identify room type: bedroom/kitchen/bathroom/balcony). **Zero-shot classification** to tag images without training ("Does this image show a swimming pool?"). **Image segmentation** for virtual staging |

### 2.2 TensorFlow.js

| Attribute | Details |
|-----------|---------|
| **What it does** | Full ML framework for training and inference in browser/Node.js. Pre-trained models for object detection (COCO-SSD), pose estimation, image classification (MobileNet), body segmentation |
| **License** | Apache 2.0 |
| **Runs in** | Browser (WebGL, WebGPU, WASM backends) AND Node.js |
| **Maturity** | Very High -- Google-backed, massive ecosystem, extensive documentation, large community |
| **Pre-trained models** | COCO-SSD (object detection), MobileNet (classification), DeepLab (segmentation), BlazeFace (face detection) |
| **Real Estate Use Case** | **COCO-SSD** for detecting objects in property photos (furniture, appliances, vehicles in parking). **MobileNet** for room classification. **Custom model training** for property-specific tasks. **DeepLab segmentation** for floor plan analysis |

### 2.3 @imgly/background-removal

| Attribute | Details |
|-----------|---------|
| **What it does** | Remove image backgrounds entirely in-browser using ONNX-based segmentation models. No server required |
| **License** | AGPL-3.0 (free for open-source use; commercial license available) |
| **Runs in** | Browser (client-side) AND Node.js |
| **Maturity** | Moderate-High -- backed by IMG.LY company, production-quality results |
| **Real Estate Use Case** | Remove backgrounds from property photos for consistent listing presentations. Isolate furniture/objects for virtual staging mockups. Clean agent profile photos |

### 2.4 face-api.js

| Attribute | Details |
|-----------|---------|
| **What it does** | Face detection, landmark recognition (68 points), face matching/recognition, expression analysis, age/gender estimation -- all in-browser on TensorFlow.js |
| **License** | MIT |
| **Runs in** | Browser (client-side) AND Node.js |
| **Maturity** | High -- 16k+ stars, widely used (note: maintenance has slowed, but still functional) |
| **Real Estate Use Case** | Auto-blur faces in property photos for privacy compliance. Verify agent identity photos. Detect people in property images that should be removed before listing |

### 2.5 ml5.js

| Attribute | Details |
|-----------|---------|
| **What it does** | Friendly ML library built on TensorFlow.js: image classification, object detection, pose estimation, style transfer, sound classification |
| **License** | MIT |
| **Runs in** | Browser (client-side) |
| **Maturity** | High -- backed by NYU ITP, good documentation, educational focus |
| **Real Estate Use Case** | Quick prototyping of image classification (room type detection). Style transfer for artistic property visualizations. Simple object detection with minimal code |

---

## 3. Analytics & Recommendations

### 3.1 Brain.js

| Attribute | Details |
|-----------|---------|
| **What it does** | GPU-accelerated neural networks in JavaScript: feedforward, RNN, LSTM, GRU, autoencoders. Supports training and inference |
| **License** | MIT |
| **Runs in** | Browser (GPU via WebGL) AND Node.js |
| **Maturity** | High -- 14k+ stars, actively maintained |
| **Real Estate Use Case** | **Price prediction**: Train LSTM on historical property prices to predict trends. **User behavior prediction**: RNN to predict which properties a user will click next. **Anomaly detection**: Autoencoder to flag unusually priced listings. **Time-series forecasting**: Predict rental yield trends by locality |

### 3.2 TensorFlow.js (for Analytics)

| Attribute | Details |
|-----------|---------|
| **What it does** | Build and train custom recommendation models, regression models, and classification models directly in-browser or Node.js |
| **License** | Apache 2.0 |
| **Runs in** | Browser AND Node.js |
| **Real Estate Use Case** | **Collaborative filtering** for property recommendations ("users who viewed this also viewed..."). **Linear/polynomial regression** for price estimation based on area, locality, floor, age. **K-means clustering** to group similar properties. **Transfer learning** to fine-tune models on local property data |

### 3.3 Transformers.js (for Embeddings & Similarity)

| Attribute | Details |
|-----------|---------|
| **What it does** | Generate text embeddings using sentence-transformers models in-browser for semantic similarity computation |
| **License** | Apache 2.0 |
| **Runs in** | Browser (client-side) |
| **Real Estate Use Case** | **Content-based recommendations**: Compute embeddings of property descriptions, recommend similar listings based on cosine similarity. **Semantic matching**: Match user preferences described in natural language to property features. "I want a quiet place with garden" matches listings mentioning "peaceful locality" and "landscaped lawn" |

### 3.4 Orama (for Recommendations via Vector Search)

| Attribute | Details |
|-----------|---------|
| **What it does** | Store property embeddings and find nearest neighbors for recommendations using built-in vector search |
| **License** | Apache 2.0 |
| **Runs in** | Browser (client-side) |
| **Real Estate Use Case** | Build a client-side recommendation engine: embed all property descriptions, store vectors in Orama index, find top-N similar properties when user views a listing. No backend needed for small-to-medium catalogs |

---

## 4. Chatbot / Conversational AI

### 4.1 WebLLM (MLC-AI)

| Attribute | Details |
|-----------|---------|
| **What it does** | Run full LLMs (Llama 3, Phi-3, Mistral 7B, Gemma, Qwen) directly in the browser using WebGPU acceleration. OpenAI-compatible API |
| **License** | Apache 2.0 |
| **Runs in** | Browser (client-side, requires WebGPU support) |
| **Maturity** | High -- backed by MLC-AI/TVM team, active development, growing model support |
| **Requirements** | WebGPU-capable browser (Chrome 113+), 4-16GB+ RAM depending on model |
| **Real Estate Use Case** | **Property assistant chatbot** that runs entirely in-browser: answer questions about listings, explain RERA regulations, help users refine search criteria. Zero server cost. Complete privacy -- user queries never leave the device. Use smaller models (Phi-3 Mini, Gemma-2B) for faster loading |

### 4.2 Ollama (Self-Hosted Backend)

| Attribute | Details |
|-----------|---------|
| **What it does** | Run LLMs locally on your server: Llama 3, Mistral, DeepSeek, Qwen, Gemma, and many more. REST API for easy integration |
| **License** | MIT |
| **Runs in** | Self-hosted backend (Linux/macOS/Windows/Docker) |
| **Maturity** | Very High -- 100k+ stars, massive ecosystem (200+ integrations), active development |
| **Real Estate Use Case** | **Backend chatbot API** for property Q&A, negotiation assistance, document summarization. **Property description generation** from structured data. **Automated email/WhatsApp responses** to inquiries. **RAG system** combining property database with LLM for intelligent search. No API costs regardless of volume |

### 4.3 Transformers.js (Text Generation)

| Attribute | Details |
|-----------|---------|
| **What it does** | Run smaller text generation models (GPT-2, DistilGPT2, Phi) in-browser for simple conversational responses |
| **License** | Apache 2.0 |
| **Runs in** | Browser (client-side) |
| **Real Estate Use Case** | Lightweight property description completion/suggestions. Simple Q&A with fine-tuned small models. FAQ auto-responses for common property queries |

### 4.4 Wink-NLP + Rule-Based Chatbot

| Attribute | Details |
|-----------|---------|
| **What it does** | Combine NLP parsing with rule-based intent matching for lightweight chatbot without LLM overhead |
| **License** | MIT |
| **Runs in** | Browser (client-side) |
| **Real Estate Use Case** | Intent classification for structured queries: detect if user wants to search, schedule visit, ask about price, or get locality info. Route to appropriate handler. Very fast, no model download required |

---

## 5. OCR & Document Processing

### 5.1 Tesseract.js

| Attribute | Details |
|-----------|---------|
| **What it does** | Full OCR engine (port of Tesseract) supporting 100+ languages via WebAssembly. Extract text from images/scanned documents |
| **License** | Apache 2.0 |
| **Runs in** | Browser (client-side) AND Node.js |
| **Maturity** | Very High -- 34k+ stars, well-maintained, widely deployed in production |
| **Real Estate Use Case** | **Extract text from property documents**: Scan agreement papers, society NOCs, RERA certificates. **Read floor plan labels** and room dimensions from images. **Digitize old property records** (Index-II, 7/12 extracts). **Extract data from visiting cards** of brokers/builders. Supports Devanagari script for Marathi/Hindi documents |

### 5.2 Transformers.js (Document Understanding)

| Attribute | Details |
|-----------|---------|
| **What it does** | Run document AI models in-browser: LayoutLM for document understanding, document question answering, table extraction |
| **License** | Apache 2.0 |
| **Runs in** | Browser (client-side) |
| **Real Estate Use Case** | **Structured extraction from property documents**: Given a scanned agreement, extract buyer name, seller name, property address, sale amount. **Document classification**: Automatically categorize uploaded documents (sale deed, agreement, NOC, tax receipt). **Table extraction** from society maintenance bills |

### 5.3 pdf.js (Mozilla)

| Attribute | Details |
|-----------|---------|
| **What it does** | Render and extract text from PDF documents in-browser |
| **License** | Apache 2.0 |
| **Runs in** | Browser (client-side) |
| **Maturity** | Very High -- Mozilla-maintained, used in Firefox, battle-tested |
| **Real Estate Use Case** | Extract text from property PDFs (brochures, floor plans, agreement drafts) for indexing and search. Render PDFs inline for document viewing. Combine with Tesseract.js for scanned PDFs |

---

## 6. Foundation / Runtime Libraries

### 6.1 ONNX Runtime Web

| Attribute | Details |
|-----------|---------|
| **What it does** | Run any ONNX-format ML model in-browser with GPU acceleration (WebGL/WebGPU/WebNN) or CPU (WASM). Universal model inference engine |
| **License** | MIT |
| **Runs in** | Browser (client-side) AND Node.js |
| **Maturity** | Very High -- Microsoft-backed, production-grade, supports all ONNX operators via WASM |
| **Real Estate Use Case** | **Foundation layer** for running custom-trained models (price prediction, image classification) exported from PyTorch/TensorFlow/scikit-learn. Run any model from ONNX Model Zoo. Powers Transformers.js and background-removal-js under the hood |

### 6.2 TensorFlow.js (as Foundation)

| Attribute | Details |
|-----------|---------|
| **What it does** | Complete ML framework: define, train, and run models. Multiple backends (WebGL, WebGPU, WASM). Load models from TF/Keras/TFLite |
| **License** | Apache 2.0 |
| **Runs in** | Browser AND Node.js AND React Native |
| **Maturity** | Very High -- Google-backed, massive ecosystem |
| **Real Estate Use Case** | Base layer for ml5.js and face-api.js. Load any pre-trained TensorFlow model. Train custom models with transfer learning using local property data |

---

## 7. Recommended Architecture for PuneNest

### Tier 1: Immediate Value (Easy Integration, High Impact)

| Use Case | Library | Effort | Impact |
|----------|---------|--------|--------|
| Property search autocomplete | **FlexSearch** or **MiniSearch** | Low | High |
| Natural language query parsing | **Compromise** | Low | High |
| OCR for property documents | **Tesseract.js** | Low | High |
| PDF text extraction | **pdf.js** | Low | Medium |

### Tier 2: Medium Effort, High Value

| Use Case | Library | Effort | Impact |
|----------|---------|--------|--------|
| Semantic/hybrid search | **Orama** | Medium | Very High |
| Room type classification (photos) | **Transformers.js** | Medium | High |
| Background removal (listing photos) | **@imgly/background-removal** | Medium | Medium |
| Property chatbot (self-hosted) | **Ollama** | Medium | Very High |
| Sentiment on reviews | **Wink-NLP** | Low | Medium |

### Tier 3: Advanced (Higher Effort, Differentiating)

| Use Case | Library | Effort | Impact |
|----------|---------|--------|--------|
| In-browser LLM chatbot | **WebLLM** | High | High |
| Price prediction model | **Brain.js** or **TensorFlow.js** | High | Very High |
| Property recommendations (embeddings) | **Transformers.js + Orama** | High | Very High |
| Object detection in photos | **TensorFlow.js (COCO-SSD)** | Medium | Medium |
| Document understanding | **Transformers.js (LayoutLM)** | High | High |
| Face blurring for privacy | **face-api.js** | Medium | Low |

### Suggested Minimal Stack

```
Client-Side (React):
  - FlexSearch/MiniSearch  -> instant property search
  - Compromise             -> parse "3BHK under 80L in Kothrud"
  - Tesseract.js           -> scan documents, extract text
  - Transformers.js        -> image classification, embeddings
  - Orama                  -> vector search + recommendations

Self-Hosted Backend:
  - Ollama                 -> chatbot, description generation
  - Natural                -> text classification, TF-IDF similarity
  - ONNX Runtime           -> custom trained models (price prediction)
```

### Performance Considerations

| Library | Initial Download | Runtime Performance | Memory |
|---------|-----------------|-------------------|--------|
| FlexSearch | ~6KB | Instant | Low |
| MiniSearch | ~7KB | Instant | Low |
| Compromise | ~250KB | Runs on keypress | Low |
| Wink-NLP | ~10KB + model | 650K tokens/sec | Low |
| Tesseract.js | ~2MB (worker + lang data) | 1-5 sec/page | Medium |
| Transformers.js | 50-500MB (per model) | Varies | High |
| WebLLM | 1-8GB (per model) | Requires WebGPU | Very High |
| TensorFlow.js | ~1MB + model | GPU-accelerated | Medium-High |
| Brain.js | ~100KB | GPU via WebGL | Medium |
| Orama | ~2KB | Very fast | Low-Medium |

### Key Recommendations

1. **Start with search**: FlexSearch + Compromise gives immediate "smart search" feel with minimal effort
2. **Add OCR early**: Tesseract.js is drop-in and immediately useful for document upload flows
3. **Ollama for chatbot**: Self-host on a modest GPU server; far more capable than browser LLMs for now
4. **WebLLM as progressive enhancement**: Offer browser-based chat for users with capable hardware, fall back to Ollama backend
5. **Transformers.js for image intelligence**: Use it to auto-tag photos (room type, features) at listing creation time
6. **Orama for semantic search**: Once you have embeddings (from Transformers.js), Orama provides instant vector search with no backend

---

## License Summary

| Library | License | Commercial Use |
|---------|---------|---------------|
| TensorFlow.js | Apache 2.0 | Yes |
| Transformers.js | Apache 2.0 | Yes |
| ONNX Runtime Web | MIT | Yes |
| WebLLM | Apache 2.0 | Yes |
| Ollama | MIT | Yes |
| Brain.js | MIT | Yes |
| ml5.js | MIT | Yes |
| FlexSearch | Apache 2.0 | Yes |
| MiniSearch | MIT | Yes |
| Lunr.js | MIT | Yes |
| Orama | Apache 2.0 | Yes |
| Tesseract.js | Apache 2.0 | Yes |
| face-api.js | MIT | Yes |
| Compromise | MIT | Yes |
| Wink-NLP | MIT | Yes |
| Natural | MIT | Yes |
| pdf.js | Apache 2.0 | Yes |
| @imgly/background-removal | AGPL-3.0 | Open-source only (paid license for proprietary) |

All libraries listed are fully free and open-source. The only exception requiring attention is `@imgly/background-removal` which uses AGPL-3.0 (requires your code to be open-source if distributed, or purchase a commercial license).
