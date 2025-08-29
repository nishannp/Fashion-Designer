/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/
import React, { useState, ChangeEvent, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { generateOutfitImage, analyzeBodyAndSuggestOutfits } from './services/geminiService';
import type { OutfitAnalysis } from './services/geminiService';
import { createStyleboard } from './lib/albumUtils';
import PolaroidCard from './components/PolaroidCard';
import Footer from './components/Footer';

type ImageStatus = 'pending' | 'done' | 'error';

interface OutfitResult {
    name: string;
    status: ImageStatus;
    url?: string;
    error?: string;
}

const primaryButtonClasses = "font-permanent-marker text-xl text-center text-black bg-yellow-400 py-3 px-8 rounded-sm transform transition-transform duration-200 hover:scale-105 hover:-rotate-2 hover:bg-yellow-300 shadow-[2px_2px_0px_2px_rgba(0,0,0,0.2)]";
const secondaryButtonClasses = "font-permanent-marker text-xl text-center text-white bg-white/10 backdrop-blur-sm border-2 border-white/80 py-3 px-8 rounded-sm transform transition-transform duration-200 hover:scale-105 hover:rotate-2 hover:bg-white hover:text-black";

// Ghost polaroids for the loading animation
const GHOST_POLAROIDS = Array(6).fill(0);

function App() {
    const [uploadedImage, setUploadedImage] = useState<string | null>(null);
    const [outfitResults, setOutfitResults] = useState<OutfitResult[]>([]);
    const [generatedOutfitsHistory, setGeneratedOutfitsHistory] = useState<string[]>([]);
    const [analysisResult, setAnalysisResult] = useState<OutfitAnalysis | null>(null);
    const [analysisStatus, setAnalysisStatus] = useState<string>('');
    const [appState, setAppState] = useState<'idle' | 'image-uploaded' | 'generating' | 'results-shown'>('idle');

    const handleImageUpload = (e: ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files[0]) {
            const file = e.target.files[0];
            const reader = new FileReader();
            reader.onloadend = () => {
                setUploadedImage(reader.result as string);
                setAppState('image-uploaded');
                setOutfitResults([]);
                setAnalysisResult(null);
                setGeneratedOutfitsHistory([]);
            };
            reader.readAsDataURL(file);
        }
    };

    const handleFindMyOutfits = async () => {
        if (!uploadedImage) return;

        setAppState('generating');
        setAnalysisStatus('Analyzing body type...');
        setOutfitResults([]);
        setAnalysisResult(null);

        try {
            // Step 1: Analyze body and suggest outfits
            const analysis = await analyzeBodyAndSuggestOutfits(
                uploadedImage,
                generatedOutfitsHistory
            );
            
            setAnalysisResult(analysis);
            setAnalysisStatus(`Found: ${analysis.bodyShape} Body Type. Generating outfits...`);
            
            const initialResults: OutfitResult[] = analysis.outfits.map(name => ({
                name,
                status: 'pending',
            }));
            setOutfitResults(initialResults);

            // Step 2: Generate images for all suggested outfits concurrently
            const generationPromises = analysis.outfits.map(async (outfit) => {
                try {
                    const resultUrl = await generateOutfitImage(uploadedImage, outfit);
                    setOutfitResults(prev => prev.map(r => r.name === outfit ? { ...r, status: 'done', url: resultUrl } : r));
                } catch (err) {
                    const errorMessage = err instanceof Error ? err.message : "An unknown error occurred.";
                    console.error(`Failed to generate outfit ${outfit}:`, err);
                    setOutfitResults(prev => prev.map(r => r.name === outfit ? { ...r, status: 'error', error: errorMessage } : r));
                }
            });

            await Promise.all(generationPromises);
            
            setGeneratedOutfitsHistory(prev => [...prev, ...analysis.outfits]);
            setAppState('results-shown');

        } catch (err) {
            const errorMessage = err instanceof Error ? err.message : "An unknown error occurred.";
            console.error(`Failed to analyze or generate outfits:`, err);
            setAnalysisStatus(errorMessage);
            setAppState('results-shown');
        } finally {
            // Clear status message after a short delay unless it's an error
            if (!analysisStatus.includes("Failed")) {
                 setTimeout(() => setAnalysisStatus(''), 2000);
            }
        }
    };
    
    const handleRegenerateSingleOutfit = async (outfitName: string) => {
        if (!uploadedImage) return;
        
        console.log(`Regenerating image for ${outfitName}...`);

        setOutfitResults(prev => prev.map(r => 
            r.name === outfitName ? { ...r, status: 'pending', error: undefined } : r
        ));

        try {
            const resultUrl = await generateOutfitImage(uploadedImage, outfitName);
            setOutfitResults(prev => prev.map(r => 
                r.name === outfitName ? { ...r, status: 'done', url: resultUrl } : r
            ));
        } catch (err) {
            const errorMessage = err instanceof Error ? err.message : "An unknown error occurred.";
            setOutfitResults(prev => prev.map(r => 
                r.name === outfitName ? { ...r, status: 'error', error: errorMessage } : r
            ));
            console.error(`Failed to regenerate image for ${outfitName}:`, err);
        }
    };
    
    const handleReset = () => {
        setUploadedImage(null);
        setOutfitResults([]);
        setAnalysisResult(null);
        setGeneratedOutfitsHistory([]);
        setAppState('idle');
    };

    const handleDownloadIndividualImage = (url: string, name: string) => {
        const link = document.createElement('a');
        link.href = url;
        link.download = `stylesyncai-${name.replace(/\s+/g, '-')}.jpg`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    };
    
    const handleDownloadStyleboard = async () => {
        const completedImages = outfitResults
            .filter(r => r.status === 'done' && r.url)
            .reduce((acc, r) => {
                acc[r.name] = r.url!;
                return acc;
            }, {} as Record<string, string>);
        
        if (Object.keys(completedImages).length === 0) {
            alert("No images have been generated successfully to create a styleboard.");
            return;
        }

        try {
            const albumUrl = await createStyleboard(completedImages);
            const link = document.createElement('a');
            link.href = albumUrl;
            link.download = `stylesyncai-styleboard.jpg`;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
        } catch (error) {
            console.error("Failed to create styleboard:", error);
            alert("Sorry, there was an error creating the downloadable styleboard.");
        }
    };
    
    const areAnyImagesDone = useMemo(() => outfitResults.some(r => r.status === 'done'), [outfitResults]);

    return (
        <main className="bg-black text-neutral-200 min-h-screen w-full flex flex-col items-center p-4 pb-32 md:pb-24 overflow-y-auto relative">
            <div className="absolute top-0 left-0 w-full h-full bg-grid-white/[0.05]"></div>
            
            <div className="z-10 flex flex-col items-center w-full flex-1 min-h-0 max-w-screen-xl mx-auto">
                <div className="text-center my-10">
                    <h1 className="text-6xl md:text-8xl font-caveat font-bold text-neutral-100">Style Sync AI</h1>
                    <p className="font-permanent-marker text-neutral-300 mt-2 text-xl tracking-wide">Dress for your body type.</p>
                </div>

                {appState === 'idle' && (
                     <div className="relative flex flex-col items-center justify-center w-full">
                        <motion.div
                             initial={{ opacity: 0, scale: 0.8 }}
                             animate={{ opacity: 1, scale: 1 }}
                             transition={{ delay: 0.5, duration: 0.8, type: 'spring' }}
                             className="flex flex-col items-center"
                        >
                            <label htmlFor="file-upload" className="cursor-pointer group transform hover:scale-105 transition-transform duration-300">
                                 <PolaroidCard 
                                     caption="Click to begin"
                                     status="done"
                                 />
                            </label>
                            <input id="file-upload" type="file" className="hidden" accept="image/png, image/jpeg, image/webp" onChange={handleImageUpload} />
                            <p className="mt-8 font-permanent-marker text-neutral-500 text-center max-w-xs text-lg">
                                Click the polaroid to upload your photo and find your perfect outfit.
                            </p>
                        </motion.div>
                    </div>
                )}

                {appState === 'image-uploaded' && uploadedImage && (
                    <div className="flex flex-col items-center gap-6">
                         <PolaroidCard 
                            imageUrl={uploadedImage} 
                            caption="Your Photo" 
                            status="done"
                         />
                         <div className="flex items-center gap-4 mt-4">
                            <button onClick={handleReset} className={secondaryButtonClasses}>
                                Different Photo
                            </button>
                            <button onClick={handleFindMyOutfits} className={primaryButtonClasses}>
                                Find My Outfits
                            </button>
                         </div>
                    </div>
                )}

                {(appState === 'generating' || appState === 'results-shown') && (
                     <div className="flex flex-col items-center justify-center gap-8 w-full">
                        {(analysisStatus || analysisResult) && (
                            <motion.div 
                                initial={{ opacity: 0, y: -20 }}
                                animate={{ opacity: 1, y: 0 }}
                                className="text-center max-w-2xl"
                            >
                                {analysisResult && (
                                    <h2 className="font-permanent-marker text-2xl text-yellow-400">
                                       Analysis: {analysisResult.bodyShape} Body Type
                                    </h2>
                                )}
                                <p className={`mt-2 text-lg text-neutral-300 ${appState === 'generating' ? 'animate-pulse' : ''}`}>
                                    {analysisStatus || analysisResult?.reason}
                                </p>
                            </motion.div>
                        )}
                        
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
                            <AnimatePresence>
                            {(appState === 'generating' ? GHOST_POLAROIDS : outfitResults).map((result, index) => (
                                <motion.div
                                    key={appState === 'generating' ? `ghost-${index}` : result.name}
                                    initial={{ opacity: 0, y: 50, rotate: Math.random() * 20 - 10 }}
                                    animate={{ opacity: 1, y: 0, rotate: 0 }}
                                    exit={{ opacity: 0, scale: 0.8 }}
                                    transition={{ duration: 0.5, delay: index * 0.1 }}
                                >
                                    <PolaroidCard
                                        caption={result.name || "Generating..."}
                                        status={result.status || 'pending'}
                                        imageUrl={result.url}
                                        error={result.error}
                                        onShake={() => handleRegenerateSingleOutfit(result.name)}
                                        onDownload={() => result.url && handleDownloadIndividualImage(result.url, result.name)}
                                    />
                                </motion.div>
                            ))}
                            </AnimatePresence>
                        </div>
                        
                        {appState === 'results-shown' && (
                             <motion.div
                                initial={{ opacity: 0, y: 20 }}
                                animate={{ opacity: 1, y: 0 }}
                                transition={{ delay: 0.5, duration: 0.5 }}
                                className="flex items-center justify-center gap-4 mt-6"
                            >
                                <button onClick={handleReset} className={secondaryButtonClasses}>
                                    Start Over
                                </button>
                                <button onClick={handleDownloadStyleboard} className={primaryButtonClasses} disabled={!areAnyImagesDone}>
                                    Download Styleboard
                                </button>
                             </motion.div>
                        )}
                    </div>
                )}
            </div>
            <Footer />
        </main>
    );
}

export default App;