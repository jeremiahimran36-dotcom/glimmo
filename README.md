# Glimmo, a talking orb

## Run on your computer
1. `pip install -r requirements.txt`
2. Open `.env` and paste your Groq key after `GROQ_API_KEY=`
3. `python app.py` then open http://localhost:5000

## Deploy on Railway
1. Push to GitHub (`.env` is ignored, so your key stays private)
2. New Railway project, deploy from the repo
3. Variables tab: add `GROQ_API_KEY` = your key
4. Open the Railway link and test

## Make the APK
1. Go to pwabuilder.com and paste your Railway link
2. Choose Android, then Generate package
3. Install the APK on your phone and allow the microphone
