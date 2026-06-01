Welcome to the seller bot script

first create a .env file with this content :

ACCOUNTS=[{"phone":"09123456789"},{"phone":"09987654321"}]
SEARCH_URL=https://divar.ir/s/tehran?q=iphone
MAX_POSTS_PER_ACCOUNT=10
DELAY_MS=3000


after config the bot try to add some phone number 
-> node custome-login.js
a browser opened and you need to login manually so a folder created called profiles you can see numbers that you login with.

after this you need to run scrapper 
-> node index.js

just watch the scrapper to done the work :)
