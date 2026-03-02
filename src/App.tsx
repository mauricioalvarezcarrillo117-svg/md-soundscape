// @ts-nocheck
import React, { useState, useEffect } from 'react';
import { initializeApp } from 'firebase/app';
import { getAuth, signInWithCustomToken, signInAnonymously, onAuthStateChanged } from 'firebase/auth';
import { getFirestore, collection, onSnapshot, doc, setDoc, deleteDoc } from 'firebase/firestore';

// --- CONFIGURACIÓN DE FIREBASE ---
// ⚠️ INSTRUCCIONES: Reemplaza los textos que dicen "TU_..." por las llaves reales
// que te dé Firebase en el Paso 4. (Mantén las comillas "").
const myFirebaseConfig = {
  apiKey: "AIzaSyAmjd0UHVW4hUdU9Ot6e4R7UE3LC5Zd86g",
  authDomain: "md-soundscape.firebaseapp.com",
  projectId: "md-soundscape",
  storageBucket: "md-soundscape.firebasestorage.app",
  messagingSenderId: "614855819468",
  appId: "1:614855819468:web:1cefe2f0a51574e5504269"
};

// Lógica de conexión inteligente (No tocar)
const isCanvasEnv = typeof __firebase_config !== 'undefined';
const firebaseConfigStr = isCanvasEnv ? __firebase_config : null;
const canvasConfig = firebaseConfigStr ? JSON.parse(firebaseConfigStr) : null;

// Si estás en tu Vercel y ya pusiste tus llaves, usa tus llaves. Si no, intenta modo local.
const finalConfig = isCanvasEnv ? canvasConfig : (myFirebaseConfig.apiKey !== "TU_API_KEY" ? myFirebaseConfig : null);

const app = finalConfig ? initializeApp(finalConfig) : null;
const auth = app ? getAuth(app) : null;
const db = app ? getFirestore(app) : null;
const appId = typeof __app_id !== 'undefined' ? __app_id : 'md-soundscape';

// --- CONFIGURACIÓN DE TEMAS ---
const THEMES = {
  light: { bg: "bg-[#F9F9F9]", fg: "text-[#000000]", card_bg: "bg-[#FFFFFF]", input_bg: "bg-[#F0F2F5]", accent: "bg-[#4A90E2]", accent_text: "text-[#4A90E2]", secondary: "bg-[#E0E0E0]", success: "bg-[#4CAF50]", error: "bg-[#FF5252]", text_sec: "text-[#444444]", border: "border-[#E0E0E0]" },
  dark: { bg: "bg-[#121212]", fg: "text-[#FFFFFF]", card_bg: "bg-[#1E1E1E]", input_bg: "bg-[#2C2C2C]", accent: "bg-[#BB86FC]", accent_text: "text-[#BB86FC]", secondary: "bg-[#333333]", success: "bg-[#03DAC6]", error: "bg-[#CF6679]", text_sec: "text-[#CCCCCC]", border: "border-[#333333]" }
};

export default function App() {
  const [themeKey, setThemeKey] = useState('light');
  const [currentView, setCurrentView] = useState('dashboard');
  
  const [cards, setCards] = useState([]);
  const [quizzes, setQuizzes] = useState([]);
  const [user, setUser] = useState(null);
  const [isDbConnected, setIsDbConnected] = useState(false);
  
  const [activeQuiz, setActiveQuiz] = useState(null);
  const [reviewQueue, setReviewQueue] = useState([]);
  
  const colors = THEMES[themeKey];
  const toggleTheme = () => setThemeKey(prev => prev === 'light' ? 'dark' : 'light');

  // --- 1. INICIALIZACIÓN DE SESIÓN (AUTENTICACIÓN) ---
  useEffect(() => {
    if (!auth) return; // Si no hay llaves válidas, no intenta conectarse.
    const initAuth = async () => {
      try {
        if (typeof __initial_auth_token !== 'undefined' && __initial_auth_token) {
          await signInWithCustomToken(auth, __initial_auth_token);
        } else {
          await signInAnonymously(auth);
        }
      } catch (error) {
        console.error("Error auth:", error);
      }
    };
    initAuth();
    const unsubscribe = onAuthStateChanged(auth, setUser);
    return () => unsubscribe();
  }, []);

  // --- 2. LECTURA DE DATOS EN LA NUBE ---
  useEffect(() => {
    if (!user || !db) return;
    setIsDbConnected(true);

    const cardsRef = collection(db, 'artifacts', appId, 'users', user.uid, 'cards');
    const unsubCards = onSnapshot(cardsRef, 
      (snapshot) => setCards(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }))),
      (error) => console.error("Error cards:", error)
    );

    const quizzesRef = collection(db, 'artifacts', appId, 'users', user.uid, 'quizzes');
    const unsubQuizzes = onSnapshot(quizzesRef, 
      (snapshot) => setQuizzes(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }))),
      (error) => console.error("Error quizzes:", error)
    );

    return () => { unsubCards(); unsubQuizzes(); };
  }, [user]);

  // --- 3. FUNCIONES DE ESCRITURA SEGURAS (Nube o Local) ---
  const saveCardToDb = async (cardData) => {
    if (db && user) {
      await setDoc(doc(db, 'artifacts', appId, 'users', user.uid, 'cards', cardData.id.toString()), cardData);
    } else {
      setCards(prev => {
        const idx = prev.findIndex(c => c.id === cardData.id);
        if (idx > -1) { const n = [...prev]; n[idx] = cardData; return n; }
        return [...prev, cardData];
      });
    }
  };

  const saveQuizToDb = async (quizData) => {
    if (db && user) {
      await setDoc(doc(db, 'artifacts', appId, 'users', user.uid, 'quizzes', quizData.id.toString()), quizData);
    } else {
      setQuizzes(prev => {
        const idx = prev.findIndex(q => q.id === quizData.id);
        if (idx > -1) { const n = [...prev]; n[idx] = quizData; return n; }
        return [...prev, quizData];
      });
    }
  };

  const deleteQuizFromDb = async (quizId) => {
    if (db && user) {
      await deleteDoc(doc(db, 'artifacts', appId, 'users', user.uid, 'quizzes', quizId.toString()));
    } else {
      setQuizzes(prev => prev.filter(q => q.id !== quizId));
    }
  };

  // --- LÓGICA DE REPASO ESPACIADO SM-2 ---
  const processCardAnswer = (card, quality) => {
    let { repetitions, interval, ef } = card;
    if (quality >= 3) {
      interval = repetitions === 0 ? 1 : (repetitions === 1 ? 6 : Math.ceil(interval * ef));
      repetitions += 1;
      card.status = 'graduated';
    } else {
      repetitions = 0;
      interval = 1;
      card.status = 'learning';
    }
    ef = Math.max(1.3, ef + (0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02)));
    const nextDate = new Date();
    nextDate.setDate(nextDate.getDate() + interval);
    return { ...card, repetitions, interval, ef, next_due: nextDate.toISOString().split('T')[0] };
  };

  // --- COMPONENTES UI REUTILIZABLES ---
  const Button = ({ children, onClick, colorClass, textColor = "text-white", className = "" }) => (
    <button onClick={onClick} className={`px-4 py-2 rounded-xl font-medium transition-transform transform hover:scale-105 active:scale-95 ${colorClass} ${textColor} ${className}`}>
      {children}
    </button>
  );

  const Input = ({ value, onChange, placeholder, isTextArea = false }) => {
    const baseClasses = `w-full p-3 rounded-xl outline-none focus:ring-2 focus:ring-[#4A90E2] transition-all ${colors.input_bg} ${colors.fg}`;
    return isTextArea ? <textarea value={value} onChange={onChange} placeholder={placeholder} rows={3} className={baseClasses} /> : <input type="text" value={value} onChange={onChange} placeholder={placeholder} className={baseClasses} />;
  };

  // --- VISTAS ---
  const Dashboard = () => {
    const today = new Date().toISOString().split('T')[0];
    const dueCards = cards.filter(c => c.next_due <= today);

    return (
      <div className={`min-h-screen p-8 transition-colors duration-300 ${colors.bg} ${colors.fg} font-sans`}>
        <div className="max-w-5xl mx-auto flex justify-between items-center mb-10">
          <div>
            <h1 className="text-4xl font-bold tracking-tight">M.D. Soundscape</h1>
            {isDbConnected ? (
              <span className="text-xs text-[#4CAF50] font-bold">● Conectado a la Nube (Firebase)</span>
            ) : (
              <span className="text-xs text-[#FF5252] font-bold">○ Modo Local (Se borrará al recargar)</span>
            )}
          </div>
          <button onClick={toggleTheme} className={`text-2xl p-3 rounded-full ${colors.secondary} hover:opacity-80 transition-opacity`}>
            {themeKey === 'light' ? '🌙' : '☀️'}
          </button>
        </div>

        <div className="max-w-5xl mx-auto space-y-8">
          <div className={`p-6 rounded-2xl shadow-sm ${colors.card_bg}`}>
            <div className="flex items-center space-x-3 mb-2">
              <span className="text-2xl">🧠</span>
              <h2 className="text-2xl font-bold">Repaso Espaciado</h2>
            </div>
            <p className={`mb-6 ${colors.text_sec}`}>Tarjetas pendientes: <span className="font-bold">{dueCards.length}</span> | Total: {cards.length}</p>
            <div className="flex space-x-4">
              <Button colorClass={colors.accent} onClick={() => {
                if (dueCards.length === 0) return alert("¡Al día! No tienes cartas pendientes hoy.");
                setReviewQueue(dueCards);
                setCurrentView('reviewCards');
              }}>Estudiar Ahora</Button>
              <Button colorClass={colors.secondary} textColor={colors.fg} onClick={() => setCurrentView('addCard')}><span className="flex items-center">➕ Crear Carta</span></Button>
              <Button colorClass={colors.secondary} textColor={colors.fg} onClick={() => setCurrentView('browseCards')}><span className="flex items-center">📋 Ver Todas</span></Button>
            </div>
          </div>

          <div className={`p-6 rounded-2xl shadow-sm flex flex-col ${colors.card_bg}`}>
            <div className="flex justify-between items-center mb-6">
              <div className="flex items-center space-x-3">
                <span className="text-2xl">📄</span>
                <h2 className="text-2xl font-bold">Evaluaciones y Casos Clínicos</h2>
              </div>
              <Button colorClass={colors.success} onClick={() => { setActiveQuiz(null); setCurrentView('editQuiz'); }}>
                <span className="flex items-center">➕ Nuevo Cuestionario</span>
              </Button>
            </div>

            <div className="space-y-4">
              {quizzes.length === 0 ? (
                <p className={colors.text_sec}>No hay cuestionarios creados aún.</p>
              ) : (
                quizzes.map((q) => {
                  const isDue = q.next_due <= today;
                  return (
                    <div key={q.id} className={`flex items-center justify-between p-4 rounded-xl border ${colors.border}`}>
                      <div className="flex items-center space-x-4">
                        <div className={`w-3 h-3 rounded-full ${isDue ? 'bg-[#FF5252]' : 'bg-[#4CAF50]'}`}></div>
                        <div>
                          <h3 className="text-lg font-bold">{q.title}</h3>
                          <p className={`text-sm ${colors.text_sec}`}>{q.questions.length} preguntas | Repaso: {q.next_due}</p>
                        </div>
                      </div>
                      <div className="flex items-center space-x-2">
                        <Button colorClass={colors.accent} onClick={() => { setActiveQuiz(q); setCurrentView('takeQuiz'); }}><span className="flex items-center">▶️ Iniciar</span></Button>
                        <button onClick={() => { setActiveQuiz(q); setCurrentView('editQuiz'); }} className={`text-lg p-2 rounded-lg hover:bg-opacity-20 hover:${colors.secondary} ${colors.fg}`}>✏️</button>
                        <button onClick={() => deleteQuizFromDb(q.id)} className="text-lg p-2 rounded-lg text-[#FF5252] hover:bg-[#FF5252] hover:bg-opacity-10">🗑️</button>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      </div>
    );
  };

  const AddCardView = () => {
    const [question, setQuestion] = useState("");
    const [answer, setAnswer] = useState("");
    const [imageStr, setImageStr] = useState(null);

    const handleImage = (e) => {
      const file = e.target.files[0];
      if (file) {
        const reader = new FileReader();
        reader.onloadend = () => setImageStr(reader.result);
        reader.readAsDataURL(file);
      }
    };

    const handleSave = async () => {
      if (!question.trim() || !answer.trim()) return;
      const newCard = {
        id: Date.now(), question, answer, image: imageStr,
        interval: 0, repetitions: 0, ef: 2.5, next_due: new Date().toISOString().split('T')[0], status: "new"
      };
      await saveCardToDb(newCard);
      setCurrentView('dashboard');
    };

    return (
      <div className={`min-h-screen p-8 ${colors.bg} ${colors.fg} flex flex-col items-center justify-center`}>
        <div className={`w-full max-w-2xl p-8 rounded-3xl shadow-lg ${colors.card_bg}`}>
          <h2 className="text-3xl font-bold mb-6">Nueva Flashcard</h2>
          <div className="space-y-6">
            <div><label className={`block text-sm mb-2 ${colors.text_sec}`}>Pregunta</label><Input isTextArea value={question} onChange={(e) => setQuestion(e.target.value)} placeholder="Ej. ¿Síntoma principal de..." /></div>
            <div><label className={`block text-sm mb-2 ${colors.text_sec}`}>Respuesta</label><Input isTextArea value={answer} onChange={(e) => setAnswer(e.target.value)} placeholder="Ej. Dolor torácico..." /></div>
            <div>
              <label className={`block flex items-center cursor-pointer text-sm font-medium ${colors.accent_text}`}>
                <span className="mr-2 text-lg">🖼️</span> Adjuntar Imagen (Max 500kb) <input type="file" accept="image/*" className="hidden" onChange={handleImage} />
              </label>
              {imageStr && <img src={imageStr} alt="Preview" className="mt-4 max-h-40 rounded-xl object-cover" />}
            </div>
            <div className="flex space-x-4 pt-4">
              <Button colorClass={colors.accent} onClick={handleSave} className="flex-1">Guardar Tarjeta</Button>
              <Button colorClass={colors.secondary} textColor={colors.fg} onClick={() => setCurrentView('dashboard')} className="flex-1">Cancelar</Button>
            </div>
          </div>
        </div>
      </div>
    );
  };

  const QuizEditorView = () => {
    const [title, setTitle] = useState(activeQuiz?.title || "");
    const [timeLimit, setTimeLimit] = useState(activeQuiz?.time_limit || 0);
    const [questions, setQuestions] = useState(activeQuiz?.questions || [{ text: "", options: ["", "", "", ""], correct_idx: 0, image: null }]);

    const handleSave = async () => {
      if (!title.trim()) return alert("El cuestionario necesita un título.");
      const cleanQuestions = questions.filter(q => q.text.trim() !== "");
      if (cleanQuestions.length === 0) return alert("Añade al menos una pregunta válida.");

      const newQuiz = {
        id: activeQuiz?.id || Date.now(),
        title, time_limit: timeLimit, questions: cleanQuestions,
        next_due: activeQuiz?.next_due || new Date().toISOString().split('T')[0],
        repetitions: activeQuiz?.repetitions || 0, ef: activeQuiz?.ef || 2.5, interval: activeQuiz?.interval || 0
      };
      await saveQuizToDb(newQuiz);
      setCurrentView('dashboard');
    };

    return (
      <div className={`min-h-screen p-8 ${colors.bg} ${colors.fg}`}>
        <div className="max-w-4xl mx-auto">
          <button onClick={() => setCurrentView('dashboard')} className={`flex items-center mb-6 hover:opacity-70 ${colors.text_sec}`}><span className="mr-2">⬅️</span> Volver</button>
          <div className="mb-8 space-y-4">
            <Input value={title} onChange={e => setTitle(e.target.value)} placeholder="Título del Cuestionario" />
            <div className="flex items-center space-x-4">
              <label className={colors.text_sec}>Tiempo límite (min):</label>
              <input type="number" min="0" value={timeLimit} onChange={e => setTimeLimit(Number(e.target.value))} className={`w-24 p-2 rounded-lg text-center ${colors.input_bg} ${colors.fg} outline-none`} />
            </div>
          </div>
          <div className="space-y-6 mb-8">
            {questions.map((q, qIndex) => (
              <div key={qIndex} className={`p-6 rounded-2xl shadow-sm ${colors.card_bg} relative`}>
                <button onClick={() => setQuestions(questions.filter((_, i) => i !== qIndex))} className="absolute top-4 right-4 text-red-500 hover:opacity-70">🗑️</button>
                <h3 className={`text-sm mb-4 font-bold ${colors.text_sec}`}>Pregunta {qIndex + 1}</h3>
                <div className="mb-4"><Input value={q.text} onChange={e => { const newQ = [...questions]; newQ[qIndex].text = e.target.value; setQuestions(newQ); }} placeholder="Escribe la pregunta aquí..." /></div>
                <div className="space-y-3">
                  {q.options.map((opt, oIndex) => (
                    <div key={oIndex} className="flex items-center space-x-3">
                      <input type="radio" name={`correct-${qIndex}`} checked={q.correct_idx === oIndex} onChange={() => { const newQ = [...questions]; newQ[qIndex].correct_idx = oIndex; setQuestions(newQ); }} className="w-5 h-5 accent-[#4A90E2] cursor-pointer" />
                      <Input value={opt} onChange={e => { const newQ = [...questions]; newQ[qIndex].options[oIndex] = e.target.value; setQuestions(newQ); }} placeholder={`Opción ${['A','B','C','D'][oIndex]}`} />
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
          <div className="flex justify-between items-center pb-20">
            <button onClick={() => setQuestions([...questions, { text: "", options: ["", "", "", ""], correct_idx: 0, image: null }])} className={`font-bold ${colors.accent_text} hover:opacity-80 flex items-center`}><span className="mr-1">➕</span> Agregar pregunta</button>
            <Button colorClass={colors.accent} onClick={handleSave}>Guardar Cuestionario</Button>
          </div>
        </div>
      </div>
    );
  };

  const ReviewCardsView = () => {
    const [currentIndex, setCurrentIndex] = useState(0);
    const [showAnswer, setShowAnswer] = useState(false);

    if (reviewQueue.length === 0 || currentIndex >= reviewQueue.length) {
      setTimeout(() => setCurrentView('dashboard'), 1500);
      return (
        <div className={`min-h-screen flex items-center justify-center ${colors.bg} ${colors.fg}`}>
          <div className="text-center"><div className="text-6xl mb-4">✅</div><h2 className="text-2xl font-bold">¡Repaso Terminado!</h2></div>
        </div>
      );
    }
    const currentCard = reviewQueue[currentIndex];

    const handleRate = async (quality) => {
      const updatedCard = processCardAnswer(currentCard, quality);
      await saveCardToDb(updatedCard);
      setShowAnswer(false);
      setCurrentIndex(prev => prev + 1);
    };

    return (
      <div className={`min-h-screen p-8 flex flex-col ${colors.bg} ${colors.fg}`}>
        <button onClick={() => setCurrentView('dashboard')} className={`self-start mb-6 hover:opacity-70 ${colors.text_sec}`}><span className="mr-2">⬅️</span> Salir</button>
        <div className="flex-1 flex flex-col items-center justify-center max-w-3xl mx-auto w-full">
          <div className={`w-full p-10 rounded-3xl shadow-lg text-center ${colors.card_bg}`}>
            <h3 className={`text-sm font-bold tracking-widest mb-6 ${colors.accent_text}`}>PREGUNTA</h3>
            <p className="text-2xl font-medium mb-8">{currentCard.question}</p>
            {currentCard.image && <img src={currentCard.image} alt="card" className="max-h-64 mx-auto rounded-xl mb-8 object-cover" />}
            
            {!showAnswer ? (
              <Button colorClass={colors.accent} onClick={() => setShowAnswer(true)} className="w-64 py-3 text-lg">Mostrar Respuesta</Button>
            ) : (
              <div className="animate-fade-in-up">
                <div className={`w-full h-px mb-8 ${colors.border} border-t`}></div>
                <p className={`text-xl mb-10 ${colors.text_sec}`}>{currentCard.answer}</p>
                <div className="flex justify-center space-x-4">
                  <Button colorClass={colors.error} onClick={() => handleRate(1)} className="w-32">Olvidé</Button>
                  <Button colorClass={colors.secondary} textColor={colors.fg} onClick={() => handleRate(3)} className="w-32">Dudoso</Button>
                  <Button colorClass={colors.success} onClick={() => handleRate(5)} className="w-32">Fácil</Button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  };

  const QuizTakerView = () => {
    if (!activeQuiz) return setCurrentView('dashboard');
    const [activeQuestions, setActiveQuestions] = useState(activeQuiz.questions.map((q, i) => ({ ...q, originalIndex: i })));
    const [currentRoundIndex, setCurrentRoundIndex] = useState(0);
    const [firstTryScore, setFirstTryScore] = useState(0);
    const [mistakesThisRound, setMistakesThisRound] = useState([]);
    const [phase, setPhase] = useState('first_pass'); 
    const [showRetryAlert, setShowRetryAlert] = useState(false);

    const handleAnswer = (selectedIndex) => {
      const currentQ = activeQuestions[currentRoundIndex];
      const isCorrect = selectedIndex === currentQ.correct_idx;
      let newMistakes = [...mistakesThisRound];
      
      if (isCorrect) { if (phase === 'first_pass') setFirstTryScore(s => s + 1); } 
      else { newMistakes.push(currentQ); }

      if (currentRoundIndex + 1 < activeQuestions.length) {
        setMistakesThisRound(newMistakes);
        setCurrentRoundIndex(currentRoundIndex + 1);
      } else {
        if (newMistakes.length > 0) {
          setActiveQuestions(newMistakes);
          setCurrentRoundIndex(0);
          setMistakesThisRound([]);
          setPhase('retry_pass');
          setShowRetryAlert(true);
          setTimeout(() => setShowRetryAlert(false), 3000);
        } else {
          setPhase('finished');
        }
      }
    };

    const handleFinishReview = async (quality) => {
      const updatedQuiz = processCardAnswer(activeQuiz, quality);
      await saveQuizToDb(updatedQuiz);
      setCurrentView('dashboard');
    };

    if (phase === 'finished') {
      const percentage = (firstTryScore / activeQuiz.questions.length) * 100;
      const passed = percentage >= 60;
      return (
        <div className={`min-h-screen flex items-center justify-center ${colors.bg} ${colors.fg}`}>
          <div className="text-center max-w-lg">
            <div className="text-6xl mb-4">{passed ? '✅' : '❌'}</div>
            <h1 className={`text-6xl font-bold mb-4 ${passed ? 'text-[#4CAF50]' : 'text-[#FF5252]'}`}>{percentage.toFixed(0)}%</h1>
            <p className="text-xl mb-8">Acertaste {firstTryScore} de {activeQuiz.questions.length} (al primer intento)</p>
            <p className={`mb-4 ${colors.text_sec}`}>¿Cómo sentiste este repaso?</p>
            <div className="flex justify-center space-x-4 mb-8">
              <Button colorClass={colors.error} onClick={() => handleFinishReview(2)}>Difícil</Button>
              <Button colorClass={colors.secondary} textColor={colors.fg} onClick={() => handleFinishReview(4)}>Bien</Button>
              <Button colorClass={colors.success} onClick={() => handleFinishReview(5)}>Fácil</Button>
            </div>
          </div>
        </div>
      );
    }
    const currentQ = activeQuestions[currentRoundIndex];
    return (
      <div className={`min-h-screen flex flex-col ${colors.bg} ${colors.fg}`}>
        <div className="p-6 flex justify-between items-center relative">
          <button onClick={() => setCurrentView('dashboard')} className={`hover:opacity-70 ${colors.text_sec}`}>❌ Salir</button>
          {showRetryAlert && <div className="absolute left-1/2 transform -translate-x-1/2 bg-[#FF5252] text-white px-6 py-2 rounded-full font-bold shadow-lg animate-pulse">Modo Corrección: Responde tus errores</div>}
          <span className={colors.text_sec}>{phase === 'retry_pass' ? `Corrección: Pregunta ${currentRoundIndex + 1} de ${activeQuestions.length}` : `Pregunta ${currentRoundIndex + 1} de ${activeQuestions.length}`}</span>
        </div>
        <div className="flex-1 flex items-center justify-center p-8">
          <div className="max-w-3xl w-full text-center">
            <h2 className="text-3xl font-bold mb-10 leading-snug">{currentQ.text}</h2>
            {currentQ.image && <img src={currentQ.image} alt="q" className="max-h-64 mx-auto rounded-xl mb-10 object-cover" />}
            <div className="grid grid-cols-1 gap-4">
              {currentQ.options.map((opt, i) => (
                <button key={i} onClick={() => handleAnswer(i)} className={`p-5 rounded-2xl text-left text-lg font-medium transition-transform transform hover:scale-[1.02] border ${colors.border} ${colors.card_bg} hover:${colors.secondary}`}>{opt}</button>
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  };

  const BrowseCardsView = () => {
    const [flipped, setFlipped] = useState({});
    const toggleFlip = (id) => setFlipped(prev => ({...prev, [id]: !prev[id]}));

    return (
      <div className={`min-h-screen p-8 ${colors.bg} ${colors.fg}`}>
        <div className="max-w-5xl mx-auto">
          <button onClick={() => setCurrentView('dashboard')} className={`flex items-center mb-6 hover:opacity-70 ${colors.text_sec}`}><span className="mr-2">⬅️</span> Volver al Inicio</button>
          <h2 className="text-3xl font-bold mb-6">Todas las Flashcards ({cards.length})</h2>
          {cards.length === 0 ? <p className={colors.text_sec}>Aún no has creado ninguna flashcard.</p> : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {cards.map(card => (
                <div key={card.id} className={`p-6 rounded-2xl shadow-sm border ${colors.border} ${colors.card_bg} flex flex-col cursor-pointer transition-transform hover:scale-[1.02] relative`} onClick={() => toggleFlip(card.id)}>
                  <div className="flex justify-between items-center mb-4">
                    <h3 className={`text-sm font-bold tracking-widest ${colors.accent_text}`}>{flipped[card.id] ? "RESPUESTA" : "PREGUNTA"}</h3>
                  </div>
                  {!flipped[card.id] ? (
                    <><p className="text-lg font-medium mb-4 flex-1">{card.question}</p>{card.image && <img src={card.image} alt="card" className="max-h-32 rounded-lg object-cover mb-4" />}</>
                  ) : (<p className={`text-lg mb-4 flex-1 ${colors.text_sec}`}>{card.answer}</p>)}
                  <p className={`text-xs mt-auto pt-4 border-t ${colors.border} ${colors.text_sec} text-center`}>Click para voltear</p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  };

  const renderView = () => {
    switch(currentView) {
      case 'addCard': return <AddCardView />;
      case 'editQuiz': return <QuizEditorView />;
      case 'reviewCards': return <ReviewCardsView />;
      case 'takeQuiz': return <QuizTakerView />;
      case 'browseCards': return <BrowseCardsView />;
      default: return <Dashboard />;
    }
  };

  return (
    <>
      <style>{` html, body, #root { margin: 0; padding: 0 !important; width: 100%; max-width: 100% !important; text-align: left !important; background-color: ${themeKey === 'light' ? '#F9F9F9' : '#121212'}; } `}</style>
      {renderView()}
    </>
  );
}
