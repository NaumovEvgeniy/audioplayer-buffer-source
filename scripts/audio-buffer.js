var changeEQ; //глобальная переменная (должна инициироваться до загрузки скрипта для установления эквалайзера по умолчанию)

window.onload = function () {

    //проверяем поддержку браузера
    try {
        var context = new (window.AudioContext || window.webkitAudioContext)(),
            reader = new FileReader();
    } catch (e) {
        alert("Браузер не поддерживает элементы HTML5 для работы плеера...");
        return;
    }

    // определение переменных

    var file,
        page = document.querySelector('.page'), //<body>
        html = document.querySelector('html'), //<html>
        dragzone = document.querySelector('.dragzone'), //блок drag 'n' drop
        inputFile = document.querySelector('.input-file'), //кнопка выбора файла на локальном диске
        artistField = document.querySelector('.song-info__artist'), // название артиста в плеере
        titleSondField = document.querySelector('.song-info__title'), // название песни в плеере
        songInfo = document.querySelector('.song-file'), // название проигрываемого файла в плеере
        canvasCtx = document.querySelector('.visualization').getContext('2d'), // контекст canvas

        playButton = document.querySelector('.player-controls__button_play'), // кнопка play
        stopButton = document.querySelector('.player-controls__button_stop'), // кнопка stop

        buffer, // хранение буффера для AudioBufferSourceNode
        source = {}, // хранение AudioBufferSourceNode
        fileStorage,// хранение принятого файла, кэшируем
        storageDecodedAudioBuffer, // хранение декодированного буффера
        prohibitionPlayind = false, // флаг запрета воспроизведения
        buffering = false, //флаг буфферизации (true когда песня декодируется в AudioBuffer)

        // определяем настройки эквалайзера
        frequencies = [70, 180, 320, 600, 1000, 3000, 6000, 12000, 14000, 16000], //частоты
        eqSettings = { //уровни усиления для каждой частоты соответственно (количество должно совпадать с количеством частот)
            'jazz': [5.1, 4.8, 4.4, 2.5, 1, 0, -1.7, -2.9, -4.4, -4.8],
            'classic': [0, 0, 0, 0, 0, 0, -4.8, -4.8, -4.8, -6.3],
            'rock': [4.8, 2.9, -3.6, -5.1, -2.5, 2.5, 5.6, 6.7, 6.7, 6.7],
            'pop': [-1.3, 2.9, 4.4, 4.8, 3.2, -1, -1.7, -1.7, -1.3, -1.3],
            'normal': [0, 0, 0, 0, 0, 0, 0, 0, 0, 0]
        };


    //реализация drag n drop

    /*
     * как только файл перетаскивают в область <html>, блок dragzone увеличивается на все окно браузера. при
     * при покидание dragzone, блок становится невидимым (display: none)
     * */
    html.addEventListener('dragenter', dragToggle, false);
    dragzone.addEventListener('dragleave', dragToggle, false);
    dragzone.addEventListener('dragover', function (e) {
        e.preventDefault();
    }, false);
    dragzone.addEventListener('drop', dragzoneDrop, false);

    /*
     * при наведение на dragzone и <html>, dragzone принимает соответствующее оформление, иначе убирается
     * @param {object} e - событие
     * */
    function dragToggle(e) {
        e.preventDefault();
        dragzone.className = (e.type === 'dragenter' ? 'dragzone dragzone_hover' : 'dragzone');
    }

    /*
     * обработка "бросания файла в окно"
     * @param {object} e - событие
     * */
    function dragzoneDrop(e) {
        dragToggle(e);
        parseFile(e.dataTransfer.files[0]);
    }



    //реализация открытия файла через инпут
    inputFile.addEventListener('change', uploadFile, false)

    /*
     * событие выбора файла из проводника
     * @param {object} - event - событие изменения состояния кнопки input:file
     * */
    function uploadFile(e) {
        file = e.target.files[0];
        parseFile(file);
    }

    /*
    * конструктор, создающий n кол-во фильтров (указанно в переменной frequencies).
    * В качестве показателя частоты выступает элементы массива frequencies для каждого фильтра соответственно.
    * */
    function EQ () {

        var filters = [];
        frequencies.forEach(function (frequency){
            var filter = context.createBiquadFilter();
            filter.type = 'peaking';
            filter.gain.value = 0;
            filter.Q.value = 1;
            filter.frequency.value = frequency;

            filters.push(filter);
        });
        this.filters = filters;
    }

    /*
    * Прототип EQ для наследников EQ. Метод изменяет уровень усиления отдельного фильтра (частоты).
    * Количество значений усиления должно совпадать с значением количество фильтров (указанно в переменной frequencies)
    *
    * @param {array} gainsArray - массив уровня усиление для каждого фильтра (частоты).
    *                             Количество элементов массива должно совпадать с значением количество фильтров (указанно в переменной frequencies)
    * */
    EQ.prototype.changeGain = function (gainsArray) {
        var filters = this.filters;
        if(filters.length === gainsArray.length) {
            // в цикле меняем значения усиления каждой частоты
            for(var i = 0; i < filters.length && i < gainsArray.length; i++){
                filters[i].gain.value = gainsArray[i];
            }
        } else {
            throw new Error('Количество регулирования частот не совпадает с количеством регулирования уровня усиления');
        }
    };


    /*
    * подключение источника звука с созданным эквалайзером.
    * последовательное подключение источника с каждым из общего кол-ва созданных фильтров
    *
    * @param {object} source - источник звука
    * return - последний фильтр, который необходимо будет подключить со следующим модулем
    * */
    function connectWithEQ (source) {

        //подкл. источник
        source.connect(equalize.filters[0]);

        //последовательно подключаем все фильтры друг за другом
        equalize.filters.reduce(function (previousValue, currentValue) {
            previousValue.connect(currentValue);
            return currentValue;
        });
        return equalize.filters[equalize.filters.length - 1];
    }


    /*
    * создание визуализатора
    * */
    function visualise () {
        WIDTH = canvasCtx.canvas.width;
        HEIGHT = canvasCtx.canvas.height;

        analyser.fftSize = 2048;
        var bufferLength = analyser.fftSize;
        console.log(bufferLength);
        var dataArray = new Uint8Array(bufferLength);

        canvasCtx.clearRect(0, 0, WIDTH, HEIGHT);

        function draw() {

            drawVisual = requestAnimationFrame(draw);

            analyser.getByteTimeDomainData(dataArray);

            canvasCtx.fillStyle = 'rgb(255, 255, 255)';
            canvasCtx.fillRect(0, 0, WIDTH, HEIGHT);

            canvasCtx.lineWidth = 2;
            canvasCtx.strokeStyle = 'rgb(0, 0, 0)';

            canvasCtx.beginPath();

            var sliceWidth = WIDTH * 1.0 / bufferLength;
            var x = 0;

            for(var i = 0; i < bufferLength; i++) {

                var v = dataArray[i] / 128.0;
                var y = v * HEIGHT/2;

                if(i === 0) {
                    canvasCtx.moveTo(x, y);
                } else {
                    canvasCtx.lineTo(x, y);
                }

                x += sliceWidth;
            }

            canvasCtx.lineTo(canvasCtx.canvas.width, canvasCtx.canvas.height/2);
            canvasCtx.stroke();
        };

        draw();

    }

    /*
    * обработка ошибок
    * */
    function errorHandler (){
        console.log('Ошибка');
    }

    /*
    * определение типа файла и чтение информации из него (мета-данные, название трека) и передача файла на чтение его как аудиофайла (если он таковым является. если не аудиофайл, пишем ошибку)
    * читает мета-данные неофициальный порт (https://github.com/webcast/taglib.js) на javascript официальной библиотеки (http://id3.org/Implementations) для парсинга этих данных
    *
    * @param {object} file - принятый файл (методом drag 'n' drop или кнопкой "открыть")
    * */
    function parseFile(file){
        if(file.type.indexOf('audio') > -1){
            if(buffering) prohibitionPlayind = true; //если уже буфферизируется файл, то выставляем запрет на воспроизведение, после окончании буйеризации 
            fileStorage = file; //кэшируем файл
            if('stop' in source) source.stop(0);
            source = {};
            //читаем мета-данные
            file.readTaglibMetadata(function(data){
                var artist = 'Неизвестный исполнитель',
                    title = 'Неизвестная композиция';

                if('metadata' in data){
                    'artist' in data.metadata ? artist = data.metadata.artist : artist;
                    'title' in data.metadata ? title = data.metadata.title : title;
                }

                artistField.textContent = artist;
                titleSondField.textContent = title;
                songInfo.textContent = file.name;


                readFile(file);
            });
        } else {
            alert('Неверный формат!');
        }
    }

    /*
    *   чтение файла как аудиофайла
    *
    *   @param {object} file - принятый файл (передается после исполнения функции parseFile)
    *   [ @param {ArrayBuffer} cashDecodedAudioBuffer ] - необязательный параметр. Передается, когда нужно воспроизвести трек из кэша, чтобы заново не декодировать буффер
    * */
    function readFile(file, cashDecodedAudioBuffer) {
        playButton.disabled = true;
        playButton.classList.add('player-controls__button_disabled');
        
        /*
        * функция создающая источник и записывает в него декодированный буффер
         * 
         * @param {array} decodedArrayBuffer - декодированный буффер 
        * */
        function getData (decodedArrayBuffer){
            storageDecodedAudioBuffer = decodedArrayBuffer;
            source = context.createBufferSource(); //создание буффера
            source.buffer = decodedArrayBuffer; //привязываем буффер к источику
            var lastFilter = connectWithEQ(source);
            lastFilter.connect(analyser); //соед. последний фильтр
            analyser.connect(context.destination); // на колонки
            buffering = false; //окончание процедуры буфферизации и связваения модулей Web Audio API

           /* если нет запрета на воспроизведение, то воспроизводим
            запрет может быть в том случае, если в момент буфферизации, пользователь дает команду на буфферизация нового файла.
            В этом случае не воспроизводим уже сбуфферизарованный файл, а начинаем работу с новым по новому кругу */
            if(!prohibitionPlayind) {
                source.start(0);
                visualise();
            }

            // снимаем запрет на воспроизведение
            prohibitionPlayind = false;

            //песня кончилась или принудительно ее остановили
            source.onended = function (e) {
                stopSong();
            }
        }

        //если переданно два аргумента (второй кэшированный буффер, для воспроизведения той же самой песни), то воспроизводим из кэша
        if(arguments.length === 2) {
            return getData(cashDecodedAudioBuffer);
        }

        buffering = true; //начало процедуры буфферизации и связваения модулей Web Audio API

        //событие окончания чтения файла как буффер
        reader.onload = function (e) {

            //декодируем буффер и передаем на создание источника
            context.decodeAudioData(e.target.result, function (decodedArrayBuffer) {
                console.log(decodedArrayBuffer);
                getData(decodedArrayBuffer);
            }, errorHandler);
        };

        //читаем полученный файл как буффер
        reader.readAsArrayBuffer(file);

    }

    /*
    * изменение эквалайзеа по клику радио кнопки из html
    * переменная changeEQ записана в глобальной области видимости, для того, чтобы при клике на радио кнопку она была определена.
    *
    * @param {object} element - радио кнопка, по которой кликнули
    * @param {string} eq - название эквалайзера (данные требуемого эквалайзера берутся из переменной eqSettings)
    * */
    changeEQ = function (element, eq){
        var inputs = document.querySelector('.choose-equalizer').getElementsByTagName('label'); //получаем все кнопки эквалайзера

        // у всех кнопок удаляем стили активной кнопки
        for(var i = 0; i < inputs.length; i++){
           inputs[i].classList.remove('choose-equalizer__name_active');
        }

        var label;
        if(element.labels){
            label = element.labels[0];
        } else if(element.previousElementSibling.nodeName.toLocaleUpperCase() === 'LABEL') {
            label = element.previousElementSibling;
        } else {
            throw new Error("Не верен label для выбора эквалайзера");
        }

        label.classList.add('choose-equalizer__name_active'); //на выбранную кнопку добавляем активный класс
        equalize.changeGain(eqSettings[eq]); //меняем настройки эквалайзера
    };


    //события play, stop

    playButton.addEventListener('click', playSong, false);
    stopButton.addEventListener('click', stopSong, false);

    /*
    * обработка события при нажатия на кнопку play
    * если песня не выбрана, браузер предложить выбрать песню из локального диска
    * */
    function playSong() {
        if(!fileStorage) return inputFile.click(); //если нет песни в плеере, то открываем проводник
        readFile(fileStorage, storageDecodedAudioBuffer);
    }

    /*
     * обработка события при нажатия на кнопку stop
     * если песня играет, убирается оформление у кнопки play, иначе функция игнорируется.
     * */
    function stopSong() {
        if(!('stop' in source)) return;
        playButton.disabled = false;
        playButton.classList.remove('player-controls__button_disabled');
        source.stop(0);
    }

    //создаем эквалайзер
    var equalize = new EQ();


    // создание анализатора
    var analyser = context.createAnalyser();


    // установление эквалайзера по умолчанию
    document.getElementById('normalEQ').click();
};